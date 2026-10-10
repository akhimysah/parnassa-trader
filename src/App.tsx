import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Interfaces chargées à la demande : le téléphone ne télécharge pas le terminal de bureau, et inversement.
const Bureau = lazy(() => import('./Bureau'));
const Mobile = lazy(() => import('./mobile/Mobile').then((m) => ({ default: m.Mobile })));
const Dialogues = lazy(() => import('./composants/Dialogues').then((m) => ({ default: m.Dialogues })));
import { ContexteTerminal, type Dialogue, type OutilDessin, type Survol, type Terminal } from './contexte';
import { reglagesModele } from './modeles';
import { evaluerAlertes } from './alertes';
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
import { useInterface } from './interface';
import { notifier } from './notifications';

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
        const r = appliquerCotations(c, cotations);
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
      const r = refus ? { compte: c, erreur: refus } : f(c);
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

  const majGraphique = useCallback(
    (id: string, patch: Partial<Graphique> | ((g: Graphique) => Partial<Graphique>)) =>
      maj((e) => ({ ...e, graphiques: e.graphiques.map((g) => (g.id === id ? { ...g, ...(typeof patch === 'function' ? patch(g) : patch) } : g)) })),
    [maj],
  );
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
      if (e.key === 'F8' && g) return faire(() => setDialogue({ type: 'proprietes', graphique: g.id }));
      if (e.key === 'F11') return faire(() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined));
      if (e.key === 'F1') return faire(() => setDialogue({ type: 'raccourcis' }));
      if (e.ctrlKey || e.metaKey) {
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
  }, [maj, majGraphique, outil, dialogue]);

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
