import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Interfaces chargées à la demande : le téléphone ne télécharge pas le terminal de bureau, et inversement.
const Bureau = lazy(() => import('./Bureau'));
const Mobile = lazy(() => import('./mobile/Mobile').then((m) => ({ default: m.Mobile })));
const Dialogues = lazy(() => import('./composants/Dialogues').then((m) => ({ default: m.Dialogues })));
import { ContexteTerminal, type Dialogue, type OutilDessin, type Survol, type Terminal } from './contexte';
import { reglagesModele } from './modeles';
import { evaluerAlertes, evaluerAlertesIndicateurs } from './alertes';
import { chargerCalendrier, devisesSymbole, valeurEvenement } from './marche/calendrier';
import { symbole } from './marche/symboles';
import { definirExpertsPerso } from './algo/experts';
import { chargerEtat, nouveauGraphique, sauverEtat, type EtatTerminal, type Graphique } from './etat';
import { definirAbonnements, definirTypeCompte, useCotations } from './marche/cotations';
import { appliquerCotations, type Compte, type Resultat } from './compte/moteur';
import { jouer } from './sons';
import { registreGraphiques } from './graphique/registre';
import { identifiant } from './etat';
import { NavigationRapide } from './composants/NavigationRapide';
import type { OngletBoite } from './composants/BoiteOutils';
import { useSynchro } from './synchro';
import { refusTrading, useComptesEnLigne } from './compte/enLigne';
import { appliquerLimiteJour, refusRisque, RISQUE_DEFAUT } from './compte/risque';
import { useInterface } from './interface';
import { notifier, synchroniserPush, type AlertePush } from './notifications';

export function App() {
  const [etat, setEtat] = useState<EtatTerminal>(chargerEtat);
  // Experts de l'assistant : lus par le moteur des experts et le testeur comme les experts intégrés.
  definirExpertsPerso(etat.expertsPerso);
  const refEtat = useRef(etat);
  // Toutes les mises à jour passent par `maj` : la référence reste à jour entre deux rendus.
  const maj = useCallback((f: (e: EtatTerminal) => EtatTerminal) => {
    const suivant = f(refEtat.current);
    if (suivant === refEtat.current) return;
    refEtat.current = suivant;
    setEtat(suivant);
  }, []);
  const cotations = useCotations();
  const refCotations = useRef(cotations);
  refCotations.current = cotations;
  const compte = etat.comptes.find((c) => c.login === etat.actif) ?? etat.comptes[0];
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [toast, setToast] = useState<{ texte: string; id: number } | null>(null);
  const [survol, setSurvol] = useState<Survol | null>(null);
  const [outil, setOutil] = useState<OutilDessin>(null);
  const [onglet, setOnglet] = useState<OngletBoite>('trading');
  const { mobile, force } = useInterface();
  // Les fenêtres du terminal (assistant, scanner, objets…) s'affichent en plein écran sur téléphone.
  useEffect(() => {
    document.body.classList.toggle('interface-mobile', mobile && !force);
    document.body.classList.toggle('interface-cadre', mobile && force);
  }, [mobile, force]);
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  const [navRapide, setNavRapide] = useState<string | null>(null);

  // ---------- Abonnements aux cotations ----------
  const cleAbonnements = useMemo(() => {
    const noms = new Set<string>(etat.observation);
    for (const c of etat.comptes) {
      for (const p of c.positions) noms.add(p.symbole);
      for (const o of c.ordres) noms.add(o.symbole);
    }
    for (const g of etat.graphiques) noms.add(g.symbole);
    for (const a of etat.alertes) if (a.active) noms.add(a.symbole);
    // Comptes en EUR : EURUSD sert à convertir profits et marges dans la devise du dépôt.
    if (etat.comptes.some((c) => c.devise === 'EUR')) noms.add('EURUSD');
    return [...noms].sort().join(',');
  }, [etat.observation, etat.comptes, etat.graphiques, etat.alertes]);
  useEffect(() => definirAbonnements(cleAbonnements.split(',').filter(Boolean)), [cleAbonnements]);
  // Les Bid/Ask affichés suivent le type du compte actif (spreads Standard ou Raw).
  const typeActif = compte.type ?? 'standard';
  useEffect(() => definirTypeCompte(typeActif), [typeActif]);

  const signaler = useCallback((texte: string) => setToast({ texte, id: Date.now() }), []);
  // Compte Parnassa : copie en ligne et synchronisation entre appareils.
  const remplacer = useCallback((e: EtatTerminal) => maj(() => e), [maj]);
  const synchro = useSynchro(etat, remplacer, signaler);
  // Comptes en ligne (serveur Parnassa-Trader) : connexion par numéro et mot de passe, état tenu sur le serveur.
  const enLigne = useComptesEnLigne(etat, maj, signaler);
  const refEnLigne = useRef(enLigne);
  refEnLigne.current = enLigne;
  // Push du serveur (terminal fermé) : exécutions des comptes en ligne et alertes Bid/Ask, réabonné à chaque changement.
  const clePush = useMemo(() => {
    const alertes: AlertePush[] = etat.alertes
      .filter((a) => a.active && (a.condition === 'bid>' || a.condition === 'bid<' || a.condition === 'ask>' || a.condition === 'ask<') && !(a.expiration && a.expiration < Date.now()))
      .map((a) => ({ id: a.id, symbole: a.symbole, condition: a.condition as AlertePush['condition'], valeur: a.valeur, commentaire: a.commentaire || undefined }));
    return JSON.stringify({ actif: etat.notifications, alertes, type: typeActif, comptes: etat.comptes.filter((c) => c.enLigne).map((c) => c.login) });
  }, [etat.notifications, etat.alertes, etat.comptes, typeActif]);
  useEffect(() => {
    const p = JSON.parse(clePush) as { actif: boolean; alertes: AlertePush[]; type: 'standard' | 'raw' };
    const t = window.setTimeout(() => void synchroniserPush(p.actif, p.alertes, p.type).catch(() => undefined), 2000);
    return () => window.clearTimeout(t);
  }, [clePush]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ---------- Moteur : ordres en attente, SL/TP, stop-out (tous les comptes) ; alertes ----------
  useEffect(() => {
    if (Object.keys(cotations).length === 0) return;
    const messages: string[] = [];
    const retour: { son: 'ok' | 'alerte' | 'stop' | null } = { son: null };
    maj((e) => {
      let change = false;
      const comptes = e.comptes.map((c) => {
        if (c.positions.length === 0 && c.ordres.length === 0) return c;
        // Compte en ligne consulté en lecture seule ou sans session : c'est l'appareil connecté qui l'exécute.
        if (c.enLigne && (c.lecture || refEnLigne.current.statut(c.login) === 'deconnecte')) return c;
        const r0 = appliquerCotations(c, cotations);
        const limite = appliquerLimiteJour(r0.compte, e.risque ?? RISQUE_DEFAUT, cotations);
        const r = { ...r0, compte: limite.compte };
        if (limite.message) {
          messages.push(limite.message);
          retour.son = 'stop';
          notifier('Limite de perte du jour', limite.message, true);
        }
        if (r.compte !== c) change = true;
        for (const ev of r.evenements) {
          messages.push(c.login === e.actif ? ev.message : `${c.login} : ${ev.message}`);
          if (e.notifications) {
            const titres = { execution: 'Ordre exécuté', sl: 'Stop Loss', tp: 'Take Profit', 'stop-out': 'Stop-out', 'appel-marge': 'Appel de marge', expiration: 'Ordre expiré', rejet: 'Ordre rejeté' };
            notifier(titres[ev.type], ev.message, ev.type === 'stop-out' || ev.type === 'appel-marge');
          }
          if (ev.type === 'stop-out' || ev.type === 'appel-marge') retour.son = 'stop';
          else if (ev.type === 'sl' || ev.type === 'tp' || ev.type === 'execution') retour.son ??= 'ok';
          else retour.son ??= 'alerte';
        }
        return r.compte;
      });
      const { alertes, declenchees } = evaluerAlertes(e.alertes, cotations, Date.now());
      for (const d of declenchees) {
        messages.push(d.message);
        retour.son = 'alerte';
        notifier(`Alerte ${d.alerte.symbole}`, d.message, true);
      }
      if (!change && alertes === e.alertes) return e;
      return { ...e, comptes, alertes };
    });
    if (messages.length) {
      signaler(messages.join(' · '));
      if (retour.son && refEtat.current.son) jouer(retour.son);
    }
  }, [cotations, maj, signaler]);

  // Alertes sur indicateur : vérifiées toutes les 30 s sur la dernière barre fermée.
  useEffect(() => {
    let actif = true;
    const verifier = async () => {
      const e = refEtat.current;
      if (!e.alertes.some((a) => a.active && a.condition === 'indicateur')) return;
      const res = await evaluerAlertesIndicateurs(e.alertes, Date.now());
      if (!actif || !res.length) return;
      maj((x) => ({
        ...x,
        alertes: x.alertes.map((a) => {
          const r = res.find((k) => k.id === a.id);
          if (!r) return a;
          const fois = (a.declenchements ?? 0) + 1;
          return { ...a, derniereBarre: r.barre, declencheeLe: Date.now(), declenchements: fois, active: fois < (a.max ?? 1) };
        }),
      }));
      signaler(res.map((r) => r.message).join(' · '));
      if (refEtat.current.son) jouer('alerte');
      for (const r of res) notifier('Alerte indicateur', r.message, true);
    };
    void verifier();
    const t = window.setInterval(() => void verifier(), 30000);
    return () => {
      actif = false;
      window.clearInterval(t);
    };
  }, [maj, signaler]);

  // Rappel avant les annonces économiques à fort impact sur les devises des symboles suivis.
  const rappelees = useRef(new Set<string>());
  useEffect(() => {
    if (!etat.rappelAnnonces) return;
    const verifier = async () => {
      const e = refEtat.current;
      const devises = new Set(e.observation.flatMap((n) => {
        const s = symbole(n);
        return s ? devisesSymbole(s) : [];
      }));
      const liste = await chargerCalendrier();
      const maintenant = Date.now();
      for (const ev of liste) {
        const avant = ev.date - maintenant;
        if (ev.importance < 1 || !devises.has(ev.devise) || avant <= 0 || avant > e.rappelAnnonces * 60_000 || rappelees.current.has(ev.id)) continue;
        rappelees.current.add(ev.id);
        const message = `Dans ${Math.max(1, Math.round(avant / 60_000))} min : ${ev.devise} — ${ev.titreFr ?? ev.titre} (prévision ${valeurEvenement(ev.prevision, ev)})`;
        signaler(message);
        if (e.son) jouer('alerte');
        notifier('Annonce économique importante', message, true);
      }
    };
    void verifier();
    const t = window.setInterval(() => void verifier(), 60_000);
    return () => window.clearInterval(t);
  }, [etat.rappelAnnonces, signaler]);

  // Sauvegarde différée (au plus une écriture par seconde).
  useEffect(() => {
    const t = window.setTimeout(() => sauverEtat(etat), 800);
    return () => window.clearTimeout(t);
  }, [etat]);
  useEffect(() => {
    const h = () => sauverEtat(refEtat.current);
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = etat.theme;
  }, [etat.theme]);
  // Thème automatique : suit le réglage clair / sombre du système.
  useEffect(() => {
    if (!etat.themeAuto) return;
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const appliquer = () => maj((e) => (e.themeAuto && e.theme !== (m.matches ? 'sombre' : 'clair') ? { ...e, theme: m.matches ? 'sombre' : 'clair' } : e));
    appliquer();
    m.addEventListener('change', appliquer);
    return () => m.removeEventListener('change', appliquer);
  }, [etat.themeAuto, maj]);
  // Écran allumé : verrou de mise en veille, repris à chaque retour sur l'application.
  useEffect(() => {
    if (!etat.ecranAllume || !('wakeLock' in navigator)) return;
    let verrou: { release: () => Promise<void> } | null = null;
    let actif = true;
    const demander = () => {
      if (document.visibilityState !== 'visible') return;
      (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
        .request('screen')
        .then((v) => {
          if (actif) verrou = v;
          else void v.release();
        })
        .catch(() => undefined);
    };
    demander();
    document.addEventListener('visibilitychange', demander);
    return () => {
      actif = false;
      document.removeEventListener('visibilitychange', demander);
      void verrou?.release();
    };
  }, [etat.ecranAllume]);

  // ---------- Actions partagées ----------
  const operer = useCallback(
    (f: (c: Compte) => Resultat, options: { confirmation?: boolean; silencieux?: boolean } = {}): Resultat => {
      const e = refEtat.current;
      const c = e.comptes.find((x) => x.login === e.actif) ?? e.comptes[0];
      const refus = refusTrading(c, refEnLigne.current.statut(c.login));
      const brut = refus ? { compte: c, erreur: refus } : f(c);
      // Garde-fous de risque : une opération qui ouvre une position ou un ordre au-delà des limites est annulée.
      const refusR = brut.erreur ? null : refusRisque(c, brut.compte, e.risque ?? RISQUE_DEFAUT, refCotations.current);
      const r = refusR ? { compte: c, erreur: refusR } : brut;
      if (r.compte !== c) maj((x) => ({ ...x, comptes: x.comptes.map((k) => (k.login === c.login ? r.compte : k)) }));
      if (r.erreur) {
        if (e.son) jouer('erreur');
        if (options.confirmation !== false && !options.silencieux) setDialogue({ type: 'resultat', titre: 'Erreur', message: r.erreur, erreur: true });
        else signaler(`Erreur : ${r.erreur}`);
      } else if (!options.silencieux) {
        if (e.son) jouer('ok');
        if (r.message) signaler(r.message);
      }
      return r;
    },
    [maj, signaler],
  );

  // Annuler (Ctrl+Z) comme MT5 : les objets et indicateurs de chaque graphique avant chaque changement. Les
  // changements rapprochés (objet tiré à la souris) ne font qu'une étape.
  const annulations = useRef<{ id: string; objets: Graphique['objets']; indicateurs: Graphique['indicateurs']; quand: number }[]>([]);
  const retablissements = useRef<{ id: string; objets: Graphique['objets']; indicateurs: Graphique['indicateurs']; quand: number }[]>([]);
  const enAnnulation = useRef(false);
  const majGraphique = useCallback(
    (id: string, patch: Partial<Graphique> | ((g: Graphique) => Partial<Graphique>)) =>
      maj((e) => ({
        ...e,
        graphiques: e.graphiques.map((g) => {
          if (g.id !== id) return g;
          const suivant = { ...g, ...(typeof patch === 'function' ? patch(g) : patch) };
          if ((suivant.objets !== g.objets || suivant.indicateurs !== g.indicateurs) && !enAnnulation.current) {
            retablissements.current = retablissements.current.filter((x) => x.id !== id);
            const pile = annulations.current;
            const der = pile[pile.length - 1];
            if (!der || der.id !== id || Date.now() - der.quand > 800) pile.push({ id, objets: g.objets, indicateurs: g.indicateurs, quand: Date.now() });
            else der.quand = Date.now();
            if (pile.length > 50) pile.shift();
          }
          return suivant;
        }),
      })),
    [maj],
  );
  const annuler = useCallback(() => {
    const e = refEtat.current;
    const pile = annulations.current;
    for (let i = pile.length - 1; i >= 0; i--) {
      if (pile[i].id !== e.graphiqueActif) continue;
      const [etape] = pile.splice(i, 1);
      const g = e.graphiques.find((x) => x.id === etape.id);
      if (!g) return;
      const quoi = etape.objets !== g.objets ? 'objets' : 'indicateurs';
      retablissements.current.push({ id: g.id, objets: g.objets, indicateurs: g.indicateurs, quand: Date.now() });
      maj((x) => ({ ...x, graphiques: x.graphiques.map((k) => (k.id === etape.id ? { ...k, objets: etape.objets, indicateurs: etape.indicateurs } : k)) }));
      signaler(`Annulé : dernier changement des ${quoi} de ${g.symbole},${g.periode} (Ctrl+Maj+Z pour rétablir)`);
      return;
    }
    signaler('Rien à annuler sur ce graphique');
  }, [maj, signaler]);
  /** Rétablir (Ctrl+Maj+Z) : refait ce que Ctrl+Z vient de défaire. */
  const retablir = useCallback(() => {
    const e = refEtat.current;
    const pile = retablissements.current;
    for (let i = pile.length - 1; i >= 0; i--) {
      if (pile[i].id !== e.graphiqueActif) continue;
      const [etape] = pile.splice(i, 1);
      const g = e.graphiques.find((x) => x.id === etape.id);
      if (!g) return;
      annulations.current.push({ id: g.id, objets: g.objets, indicateurs: g.indicateurs, quand: 0 });
      enAnnulation.current = true;
      maj((x) => ({ ...x, graphiques: x.graphiques.map((k) => (k.id === etape.id ? { ...k, objets: etape.objets, indicateurs: etape.indicateurs } : k)) }));
      enAnnulation.current = false;
      signaler(`Rétabli sur ${g.symbole},${g.periode}`);
      return;
    }
    signaler('Rien à rétablir sur ce graphique');
  }, [maj, signaler]);
  const ouvrirGraphique = useCallback(
    (sym: string, periode?: Graphique['periode']) =>
      maj((e) => {
        const actif = e.graphiques.find((g) => g.id === e.graphiqueActif);
        const defaut = e.modeles.find((m) => m.nom === e.modeleDefaut);
        const g = nouveauGraphique(sym, periode ?? actif?.periode ?? 'H1', defaut ? reglagesModele(defaut) : actif ? { schema: actif.schema, type: actif.type } : undefined);
        return { ...e, graphiques: [...e.graphiques, g], graphiqueActif: g.id };
      }),
    [maj],
  );

  const terminal: Terminal = {
    etat,
    maj,
    compte,
    cotations,
    operer,
    dialogue,
    ouvrir: setDialogue,
    fermer: useCallback(() => setDialogue(null), []),
    majGraphique,
    ouvrirGraphique,
    signaler,
    survol: setSurvol,
    survolActuel: survol,
    outil,
    choisirOutil: setOutil,
    mobile,
    synchro,
    enLigne,
  };

  // ---------- Raccourcis clavier façon MT5 ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      const saisie = cible && ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName);
      const etatActuel = refEtat.current;
      const g = etatActuel.graphiques.find((x) => x.id === etatActuel.graphiqueActif);
      const panneau = (cle: keyof EtatTerminal['panneaux']) => maj((x) => ({ ...x, panneaux: { ...x.panneaux, [cle]: !x.panneaux[cle] } }));
      const touche = e.key.toLowerCase();
      const faire = (f: () => void) => {
        e.preventDefault();
        f();
      };
      if (e.key === 'Escape' && outil) return faire(() => setOutil(null));
      if (e.key === 'F9') return faire(() => setDialogue({ type: 'ordre' }));
      if (e.key === 'F4') return faire(() => setDialogue({ type: 'metaediteur' }));
      if (e.key === 'F8' && g) return faire(() => setDialogue({ type: 'proprietes', graphique: g.id }));
      if (e.key === 'F11') return faire(() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined));
      if (e.key === 'F1') return faire(() => setDialogue({ type: 'raccourcis' }));
      if (e.ctrlKey || e.metaKey) {
        if (touche === 'z' && !saisie) return faire(e.shiftKey ? retablir : annuler);
        if (touche === 'm') return faire(() => panneau('observation'));
        if (touche === 'n') return faire(() => panneau('navigateur'));
        if (touche === 't') return faire(() => panneau('boite'));
        if (touche === 'u') return faire(() => setDialogue({ type: 'symboles' }));
        if (touche === 'o') return faire(() => setDialogue({ type: 'options' }));
        if (touche === 'e') return faire(() => maj((x) => ({ ...x, algo: !x.algo })));
        if (touche === 'r') return faire(() => panneau('testeur'));
        if (touche === 'd') return faire(() => panneau('donnees'));
        if (g && touche === 'g') return faire(() => majGraphique(g.id, { grille: !g.grille }));
        if (g && touche === 'y') return faire(() => majGraphique(g.id, { separateurs: !g.separateurs }));
        if (g && touche === 'i') return faire(() => setDialogue({ type: 'liste-indicateurs', graphique: g.id }));
        if (g && touche === 'b') return faire(() => setDialogue({ type: 'objets', graphique: g.id }));
        if (g && touche === 'l')
          return faire(() =>
            majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.some((i) => i.type === 'volumes') ? gr.indicateurs.filter((i) => i.type !== 'volumes') : [...gr.indicateurs, { id: identifiant(), type: 'volumes', p: {}, couleur: '#32cd32' }] })),
          );
        return;
      }
      if (e.altKey && g) {
        if (e.code === 'Digit1') return faire(() => majGraphique(g.id, { type: 'barres' }));
        if (e.code === 'Digit2') return faire(() => majGraphique(g.id, { type: 'bougies' }));
        if (e.code === 'Digit3') return faire(() => majGraphique(g.id, { type: 'ligne' }));
        if (e.code === 'Digit4') return faire(() => majGraphique(g.id, { type: 'heikin' }));
        if (e.code === 'KeyT') return faire(() => majGraphique(g.id, { unClic: !g.unClic }));
        if (e.code === 'KeyB') return faire(() => setDialogue({ type: 'profondeur', symbole: g.symbole }));
        if (e.code === 'KeyR') return faire(() => maj((x) => ({ ...x, disposition: x.disposition === 'mosaique' ? 'onglets' : 'mosaique' })));
        return;
      }
      if (saisie || dialogue || !g) return;
      // Navigation rapide : une lettre ou un chiffre tapé sur le graphique ouvre le champ symbole / période.
      if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.altKey && !mobileRef.current) return faire(() => setNavRapide(e.key.toUpperCase()));
      if (e.key === '+' || e.key === '=') return faire(() => registreGraphiques.get(g.id)?.zoomer(1.25));
      if (e.key === '-') return faire(() => registreGraphiques.get(g.id)?.zoomer(0.8));
      if (e.key === 'End') return faire(() => registreGraphiques.get(g.id)?.allerALaFin());
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [maj, majGraphique, outil, dialogue, annuler, retablir]);

  const texteSurvol = survol
    ? `${new Date(survol.temps).toLocaleString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}   O: ${survol.o.toFixed(survol.chiffres)}   H: ${survol.h.toFixed(survol.chiffres)}   L: ${survol.l.toFixed(survol.chiffres)}   C: ${survol.c.toFixed(survol.chiffres)}   V: ${Math.round(survol.v)}`
    : '';

  return (
    <ContexteTerminal.Provider value={terminal}>
      {mobile ? (
        <div className={force ? 'fond-cadre' : 'plein'}>
          <Suspense fallback={<div className="chargement-app">Parnassa Trader…</div>}>
            <Mobile cadre={force} />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={<div className="chargement-app">Parnassa Trader…</div>}>
          <Bureau texteSurvol={texteSurvol} onglet={onglet} changerOnglet={setOnglet} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <Dialogues />
      </Suspense>
      {navRapide !== null && (
        <NavigationRapide
          initial={navRapide}
          fermer={() => setNavRapide(null)}
          appliquer={(r) => majGraphique(etat.graphiqueActif, { ...(r.symbole ? { symbole: r.symbole } : {}), ...(r.periode ? { periode: r.periode } : {}) })}
        />
      )}
      {toast && (
        <div key={toast.id} className="toast" role="status" onClick={() => setToast(null)}>
          {toast.texte}
        </div>
      )}
    </ContexteTerminal.Provider>
  );
}
