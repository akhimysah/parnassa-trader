import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { identifiant, nouveauGraphique, type EtatTerminal, type Graphique } from '../etat';
import { chargerProfil, demanderNom, enregistrerModele, enregistrerProfil, reglagesModele } from '../modeles';
import { PERIODES } from '../marche/bougies';
import { SYMBOLES } from '../marche/symboles';
import { DEFINITIONS, GROUPES } from '../graphique/indicateurs';
import { registreGraphiques } from '../graphique/registre';
import { REST_BINANCE } from '../marche/binance';
import { ListeMenu, type ElementMenu } from './ui';
import { OBJETS } from '../graphique/dessins';
import { IndicateurSynchro } from './Synchro';
import { LIBELLE_STATUT } from './DialoguesComptes';
import { choisirInterface } from '../interface';

export function useActions() {
  const t = useTerminal();
  const { etat, maj, ouvrir, majGraphique, ouvrirGraphique, choisirOutil } = t;
  const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif);
  const panneau = (cle: keyof typeof etat.panneaux) => maj((e) => ({ ...e, panneaux: { ...e.panneaux, [cle]: !e.panneaux[cle] } }));
  const majActif = (patch: Partial<Graphique> | ((g: Graphique) => Partial<Graphique>)) => g && majGraphique(g.id, patch);
  const basculerVolumes = () =>
    majActif((gr) => ({
      indicateurs: gr.indicateurs.some((i) => i.type === 'volumes') ? gr.indicateurs.filter((i) => i.type !== 'volumes') : [...gr.indicateurs, { id: identifiant(), type: 'volumes', p: {}, couleur: '#32cd32' }],
    }));
  const pleinEcran = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined);
  const fermerGraphique = (id: string) =>
    maj((e) => {
      const graphiques = e.graphiques.filter((x) => x.id !== id);
      return { ...e, graphiques, graphiqueActif: e.graphiqueActif === id ? (graphiques[graphiques.length - 1]?.id ?? '') : e.graphiqueActif };
    });
  return { g, panneau, majActif, basculerVolumes, pleinEcran, fermerGraphique, ouvrir, ouvrirGraphique, choisirOutil, etat, maj };
}

function menus(a: ReturnType<typeof useActions>): [string, ElementMenu[]][] {
  const { g, etat, maj, ouvrir, panneau, majActif, basculerVolumes, pleinEcran, fermerGraphique, ouvrirGraphique, choisirOutil } = a;
  const groupes = [...new Set(SYMBOLES.map((s) => s.chemin.split('\\')[0]))];
  const indicateurs = (groupe: string): ElementMenu[] =>
    DEFINITIONS.filter((d) => d.groupe === groupe).map((d) => ({ libelle: d.nom, desactive: !g, action: () => g && ouvrir({ type: 'indicateur', indicateur: d.type, graphique: g.id }) }));
  return [
    [
      'Fichier',
      [
        { libelle: 'Nouveau graphique', sousMenu: groupes.map((gr) => ({ libelle: gr, sousMenu: SYMBOLES.filter((s) => s.chemin.startsWith(gr)).map((s) => ({ libelle: `${s.nom}, ${s.description}`, action: () => ouvrirGraphique(s.nom) })) })) },
        { libelle: 'Fermer le graphique', raccourci: 'Ctrl+F4', desactive: !g, action: () => g && fermerGraphique(g.id) },
        { libelle: 'Enregistrer comme image', desactive: !g, action: () => g && registreGraphiques.get(g.id)?.capturer() },
        { separateur: true },
        { libelle: 'Profils', sousMenu: menuProfils(etat, maj) },
        { separateur: true },
        { libelle: 'Ouvrir un compte…', action: () => ouvrir({ type: 'compte' }) },
        { libelle: 'Se connecter à un compte de trading…', action: () => ouvrir({ type: 'connexion' }) },
        { libelle: 'Dépôt / retrait…', action: () => ouvrir({ type: 'depot' }) },
        { separateur: true },
        { libelle: 'Compte Parnassa et synchronisation…', action: () => ouvrir({ type: 'synchro' }) },
      ],
    ],
    [
      'Affichage',
      [
        { libelle: 'Barre d\'outils', coche: etat.panneaux.barreOutils, action: () => panneau('barreOutils') },
        { libelle: 'Barre d\'état', coche: etat.panneaux.barreEtat, action: () => panneau('barreEtat') },
        { separateur: true },
        { libelle: 'Rapport de trading', action: () => ouvrir({ type: 'rapport' }) },
        { libelle: 'Symboles', raccourci: 'Ctrl+U', action: () => ouvrir({ type: 'symboles' }) },
        { libelle: 'Profondeur du marché', raccourci: 'Alt+B', desactive: !g, action: () => g && ouvrir({ type: 'profondeur', symbole: g.symbole }) },
        { separateur: true },
        { libelle: 'Observation du marché', raccourci: 'Ctrl+M', coche: etat.panneaux.observation, action: () => panneau('observation') },
        { libelle: 'Navigateur', raccourci: 'Ctrl+N', coche: etat.panneaux.navigateur, action: () => panneau('navigateur') },
        { libelle: 'Boîte à outils', raccourci: 'Ctrl+T', coche: etat.panneaux.boite, action: () => panneau('boite') },
        { libelle: 'Testeur de stratégie', raccourci: 'Ctrl+R', coche: etat.panneaux.testeur, action: () => panneau('testeur') },
        { separateur: true },
        { libelle: 'Thème sombre', coche: etat.theme === 'sombre', action: () => maj((e) => ({ ...e, theme: e.theme === 'sombre' ? 'clair' : 'sombre' })) },
        { libelle: 'Plein écran', raccourci: 'F11', action: pleinEcran },
        { libelle: 'Interface mobile (façon MT5 mobile)', action: () => choisirInterface('mobile') },
      ],
    ],
    [
      'Insertion',
      [
        { libelle: 'Indicateurs', sousMenu: GROUPES.map((gr) => ({ libelle: gr, sousMenu: indicateurs(gr) })) },
        {
          libelle: 'Objets',
          sousMenu: [
            ...(Object.keys(OBJETS) as (keyof typeof OBJETS)[]).map((o) => ({ libelle: OBJETS[o].nom, desactive: !g, action: () => choisirOutil(o) })),
            { separateur: true },
            { libelle: 'Liste des objets…', raccourci: 'Ctrl+B', desactive: !g, action: () => g && ouvrir({ type: 'objets', graphique: g.id }) },
          ],
        },
      ],
    ],
    [
      'Graphiques',
      [
        { libelle: 'Liste des indicateurs', raccourci: 'Ctrl+I', desactive: !g, action: () => g && ouvrir({ type: 'liste-indicateurs', graphique: g.id }) },
        { libelle: 'Liste des objets', raccourci: 'Ctrl+B', desactive: !g, action: () => g && ouvrir({ type: 'objets', graphique: g.id }) },
        { separateur: true },
        { libelle: 'Barres', raccourci: 'Alt+1', coche: g?.type === 'barres', action: () => majActif({ type: 'barres' }) },
        { libelle: 'Bougies japonaises', raccourci: 'Alt+2', coche: g?.type === 'bougies', action: () => majActif({ type: 'bougies' }) },
        { libelle: 'Ligne', raccourci: 'Alt+3', coche: g?.type === 'ligne', action: () => majActif({ type: 'ligne' }) },
        { libelle: 'Période', sousMenu: PERIODES.map((p) => ({ libelle: p.libelle, raccourci: p.id, coche: g?.periode === p.id, action: () => majActif({ periode: p.id }) })) },
        { separateur: true },
        { libelle: 'Défilement automatique', coche: g?.defilement, action: () => majActif((x) => ({ defilement: !x.defilement })) },
        { libelle: 'Décalage du graphique', coche: g?.decalage, action: () => majActif((x) => ({ decalage: !x.decalage })) },
        { libelle: 'Grille', raccourci: 'Ctrl+G', coche: g?.grille, action: () => majActif((x) => ({ grille: !x.grille })) },
        { libelle: 'Volumes', raccourci: 'Ctrl+L', coche: g?.indicateurs.some((i) => i.type === 'volumes'), action: basculerVolumes },
        { libelle: 'Trading en un clic', raccourci: 'Alt+T', coche: g?.unClic, action: () => majActif((x) => ({ unClic: !x.unClic })) },
        { separateur: true },
        { libelle: 'Zoom avant', raccourci: '+', action: () => g && registreGraphiques.get(g.id)?.zoomer(1.25) },
        { libelle: 'Zoom arrière', raccourci: '−', action: () => g && registreGraphiques.get(g.id)?.zoomer(0.8) },
        { libelle: 'Modèle', desactive: !g, sousMenu: g ? menuModeles(etat, maj, g) : [] },
        { libelle: 'Propriétés…', raccourci: 'F8', desactive: !g, action: () => g && ouvrir({ type: 'proprietes', graphique: g.id }) },
      ],
    ],
    [
      'Outils',
      [
        { libelle: 'Nouvel ordre', raccourci: 'F9', action: () => ouvrir({ type: 'ordre' }) },
        { libelle: 'Nouvelle alerte…', action: () => ouvrir({ type: 'alerte', symbole: g?.symbole }) },
        { libelle: 'Algo Trading', raccourci: 'Ctrl+E', coche: etat.algo, action: () => maj((e) => ({ ...e, algo: !e.algo })) },
        { libelle: 'Expert Advisor sur le graphique…', desactive: !g, action: () => g && ouvrir({ type: 'expert', graphique: g.id, expert: g.expert?.type }) },
        { separateur: true },
        { libelle: 'Options', raccourci: 'Ctrl+O', action: () => ouvrir({ type: 'options' }) },
      ],
    ],
    [
      'Fenêtre',
      [
        { libelle: 'Nouvelle fenêtre', sousMenu: SYMBOLES.slice(0, 20).map((s) => ({ libelle: s.nom, action: () => ouvrirGraphique(s.nom) })) },
        { libelle: 'Mosaïque', raccourci: 'Alt+R', coche: etat.disposition === 'mosaique', action: () => maj((e) => ({ ...e, disposition: 'mosaique' })) },
        { libelle: 'Onglets', coche: etat.disposition === 'onglets', action: () => maj((e) => ({ ...e, disposition: 'onglets' })) },
        { separateur: true },
        ...etat.graphiques.map((x, i) => ({ libelle: `${i + 1} ${x.symbole},${x.periode}`, coche: x.id === etat.graphiqueActif, action: () => maj((e) => ({ ...e, graphiqueActif: x.id })) })),
      ],
    ],
    [
      'Aide',
      [
        { libelle: 'Raccourcis clavier', action: () => ouvrir({ type: 'raccourcis' }) },
        { libelle: 'À propos', action: () => ouvrir({ type: 'apropos' }) },
      ],
    ],
  ];
}

/** Barre de menus façon Windows : un clic ouvre un menu, le survol passe d'un menu à l'autre. */
export function BarreMenus() {
  const a = useActions();
  const [ouvert, setOuvert] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ouvert === null) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOuvert(null);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOuvert(null);
    window.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [ouvert]);
  const liste = menus(a);
  return (
    <div className="barre-menus" ref={ref}>
      <img className="logo" src={`${import.meta.env.BASE_URL}icone.svg`} alt="" />
      {liste.map(([titre, elements], i) => (
        <div key={titre} className={`menu-titre${ouvert === i ? ' ouvert' : ''}`} onMouseDown={() => setOuvert(ouvert === i ? null : i)} onMouseEnter={() => ouvert !== null && setOuvert(i)}>
          {titre}
          {ouvert === i && (
            <div className="menu-deroulant" onMouseDown={(e) => e.stopPropagation()}>
              <ListeMenu elements={elements} fermer={() => setOuvert(null)} />
            </div>
          )}
        </div>
      ))}
      <span className="barre-menus-compte">
        {a.etat.comptes.find((c) => c.login === a.etat.actif)?.login} : {a.etat.comptes.find((c) => c.login === a.etat.actif)?.nom} — {a.etat.comptes.find((c) => c.login === a.etat.actif)?.serveur} : Démo {a.etat.comptes.find((c) => c.login === a.etat.actif)?.type === 'raw' ? 'Raw' : 'Standard'}
      </span>
    </div>
  );
}

export function BarreOutils() {
  const a = useActions();
  const { g, ouvrir, majActif, ouvrirGraphique, etat, choisirOutil } = a;
  const { outil } = useTerminal();
  return (
    <div className="barre-outils">
      <button title="Nouveau graphique" onClick={() => ouvrirGraphique(g?.symbole ?? 'EURUSD')}>
        <svg viewBox="0 0 20 20"><rect x="2" y="3" width="16" height="14" fill="none" stroke="currentColor" /><path d="M5 13l3-4 3 2 4-6" fill="none" stroke="#1e90ff" strokeWidth="1.5" /><path d="M14 13h4M16 11v4" stroke="#00a050" strokeWidth="1.6" /></svg>
      </button>
      <span className="sep" />
      <button className="bouton-texte" title="Nouvel ordre (F9)" onClick={() => ouvrir({ type: 'ordre' })}>
        <svg viewBox="0 0 20 20"><path d="M3 15l4-5 3 3 6-8" fill="none" stroke="#00a050" strokeWidth="2" /><path d="M13 5h3v3" fill="none" stroke="#00a050" strokeWidth="2" /></svg>
        Nouvel ordre
      </button>
      <button className={`bouton-texte${etat.unClicAccepte ? ' actif' : ''}`} title="Trading en un clic" onClick={() => (etat.unClicAccepte ? a.maj((e) => ({ ...e, unClicAccepte: false })) : ouvrir({ type: 'unclic' }))}>
        <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill={etat.unClicAccepte ? '#00a050' : '#c0392b'} /><path d="M7 10l2 2 4-4" stroke="#fff" strokeWidth="2" fill="none" /></svg>
        Un clic
      </button>
      <button className={`bouton-texte algo${etat.algo ? ' actif' : ''}`} title="Algo Trading : autorise les Expert Advisors à trader" onClick={() => a.maj((e) => ({ ...e, algo: !e.algo }))}>
        <svg viewBox="0 0 20 20">{etat.algo ? <path d="M6 4l10 6-10 6z" fill="#1e9e3a" /> : <rect x="5" y="5" width="10" height="10" fill="#c0392b" />}</svg>
        Algo Trading
      </button>
      <button className={`bouton-texte${etat.panneaux.testeur ? ' actif' : ''}`} title="Testeur de stratégie (Ctrl+R)" onClick={() => a.panneau('testeur')}>
        <svg viewBox="0 0 20 20"><path d="M3 16l4-5 3 2 6-8" fill="none" stroke="#1e6fd9" strokeWidth="1.6" /><circle cx="15" cy="14" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M17 16l2 2" stroke="currentColor" strokeWidth="1.6" /></svg>
        Testeur
      </button>
      <span className="sep" />
      <button title="Barres (Alt+1)" className={g?.type === 'barres' ? 'actif' : ''} onClick={() => majActif({ type: 'barres' })}>
        <svg viewBox="0 0 20 20"><path d="M5 4v12M3 7h2M5 13h2M12 3v12M10 6h2M12 11h2" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <button title="Bougies japonaises (Alt+2)" className={g?.type === 'bougies' ? 'actif' : ''} onClick={() => majActif({ type: 'bougies' })}>
        <svg viewBox="0 0 20 20"><path d="M6 3v14M14 3v14" stroke="currentColor" /><rect x="4" y="6" width="4" height="7" fill="#26a69a" /><rect x="12" y="5" width="4" height="8" fill="#ef5350" /></svg>
      </button>
      <button title="Ligne (Alt+3)" className={g?.type === 'ligne' ? 'actif' : ''} onClick={() => majActif({ type: 'ligne' })}>
        <svg viewBox="0 0 20 20"><path d="M2 15l5-6 4 3 7-8" fill="none" stroke="#1e90ff" strokeWidth="1.6" /></svg>
      </button>
      <span className="sep" />
      <button title="Zoom avant (+)" onClick={() => g && registreGraphiques.get(g.id)?.zoomer(1.25)}>
        <svg viewBox="0 0 20 20"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12 12l5 5M6 8h4M8 6v4" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <button title="Zoom arrière (−)" onClick={() => g && registreGraphiques.get(g.id)?.zoomer(0.8)}>
        <svg viewBox="0 0 20 20"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12 12l5 5M6 8h4" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      <button title="Mosaïque (Alt+R)" className={etat.disposition === 'mosaique' ? 'actif' : ''} onClick={() => a.maj((e) => ({ ...e, disposition: e.disposition === 'mosaique' ? 'onglets' : 'mosaique' }))}>
        <svg viewBox="0 0 20 20"><rect x="2" y="3" width="7" height="6" fill="none" stroke="currentColor" /><rect x="11" y="3" width="7" height="6" fill="none" stroke="currentColor" /><rect x="2" y="11" width="7" height="6" fill="none" stroke="currentColor" /><rect x="11" y="11" width="7" height="6" fill="none" stroke="currentColor" /></svg>
      </button>
      <button title="Défilement automatique" className={g?.defilement ? 'actif' : ''} onClick={() => majActif((x) => ({ defilement: !x.defilement }))}>
        <svg viewBox="0 0 20 20"><path d="M3 10h12M11 6l4 4-4 4" fill="none" stroke="#00a050" strokeWidth="1.8" /></svg>
      </button>
      <button title="Décalage du graphique" className={g?.decalage ? 'actif' : ''} onClick={() => majActif((x) => ({ decalage: !x.decalage }))}>
        <svg viewBox="0 0 20 20"><path d="M3 4v12M3 10h9" stroke="currentColor" strokeWidth="1.5" /><path d="M14 7v6l3-3z" fill="#1e90ff" /></svg>
      </button>
      <span className="sep" />
      <button title="Indicateurs" onClick={() => g && ouvrir({ type: 'liste-indicateurs', graphique: g.id })}>
        <svg viewBox="0 0 20 20"><text x="4" y="15" fontSize="14" fontStyle="italic" fill="currentColor">f</text><path d="M10 14l2-4 2 2 3-6" fill="none" stroke="#1e90ff" strokeWidth="1.3" /></svg>
      </button>
      <button title="Ligne horizontale" className={outil === 'horizontale' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'horizontale' ? null : 'horizontale')}>
        <svg viewBox="0 0 20 20"><path d="M2 10h16" stroke="#ff3b30" strokeWidth="1.6" /></svg>
      </button>
      <button title="Ligne de tendance" className={outil === 'tendance' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'tendance' ? null : 'tendance')}>
        <svg viewBox="0 0 20 20"><path d="M3 16L17 4" stroke="#1e90ff" strokeWidth="1.6" /><circle cx="3" cy="16" r="1.6" fill="#1e90ff" /><circle cx="17" cy="4" r="1.6" fill="#1e90ff" /></svg>
      </button>
      <button title="Retracement de Fibonacci" className={outil === 'fibo' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'fibo' ? null : 'fibo')}>
        <svg viewBox="0 0 20 20"><path d="M2 4h16M2 8h16M2 11h16M2 16h16" stroke="#dc143c" strokeWidth="1" strokeDasharray="2 1" /></svg>
      </button>
      <button title="Ligne verticale" className={outil === 'verticale' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'verticale' ? null : 'verticale')}>
        <svg viewBox="0 0 20 20"><path d="M10 2v16" stroke="#808080" strokeWidth="1.6" /></svg>
      </button>
      <button title="Canal équidistant" className={outil === 'canal' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'canal' ? null : 'canal')}>
        <svg viewBox="0 0 20 20"><path d="M2 11L14 3M6 17L18 9" stroke="#9932cc" strokeWidth="1.5" /></svg>
      </button>
      <button title="Rectangle" className={outil === 'rectangle' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'rectangle' ? null : 'rectangle')}>
        <svg viewBox="0 0 20 20"><rect x="3" y="5" width="14" height="10" fill="#20b2aa33" stroke="#20b2aa" strokeWidth="1.4" /></svg>
      </button>
      <button title="Texte" className={outil === 'texte' ? 'actif' : ''} onClick={() => choisirOutil(outil === 'texte' ? null : 'texte')}>
        <svg viewBox="0 0 20 20"><text x="5" y="15" fontSize="14" fontWeight="700" fill="#ffa500">A</text></svg>
      </button>
      <span className="sep" />
      <div className="periodes">
        {PERIODES.map((p) => (
          <button key={p.id} className={g?.periode === p.id ? 'actif' : ''} title={p.libelle} onClick={() => majActif({ periode: p.id })}>
            {p.id}
          </button>
        ))}
      </div>
      <span className="sep" />
      <button title="Ajouter un graphique" className="bouton-texte" onClick={() => a.maj((e) => {
        const ng = nouveauGraphique(g?.symbole ?? 'EURUSD', g?.periode ?? 'H1');
        return { ...e, graphiques: [...e.graphiques, ng], graphiqueActif: ng.id };
      })}>
        + Graphique
      </button>
    </div>
  );
}

/** Barre d'état : aide, données de la barre survolée, latence réelle vers le serveur de cotations. */
export function BarreEtat({ texteSurvol }: { texteSurvol: string }) {
  const [ping, setPing] = useState<number | null>(null);
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  useEffect(() => {
    let actif = true;
    const mesurer = async () => {
      const t0 = performance.now();
      try {
        await fetch(`${REST_BINANCE}/ping`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (actif) {
          setPing(Math.round(performance.now() - t0));
          setEnLigne(true);
        }
      } catch {
        if (actif) setEnLigne(false);
      }
    };
    void mesurer();
    const t = window.setInterval(mesurer, 15000);
    return () => {
      actif = false;
      window.clearInterval(t);
    };
  }, []);
  const barres = !enLigne ? 0 : ping === null ? 1 : ping < 120 ? 4 : ping < 250 ? 3 : ping < 500 ? 2 : 1;
  return (
    <div className="barre-etat">
      <span className="be-aide">Pour obtenir de l'aide, appuyez sur F1</span>
      <span className="be-defaut">Défaut</span>
      <span className="be-survol">{texteSurvol}</span>
      <IndicateurCompte />
      <span className="be-synchro-case">
        <IndicateurSynchro />
      </span>
      <span className={`be-connexion ${enLigne ? '' : 'hors-ligne'}`} title={enLigne ? `Connecté — ${ping ?? '…'} ms` : 'Pas de connexion'}>
        <span className="be-barres">
          {[1, 2, 3, 4].map((i) => (
            <i key={i} className={i <= barres ? 'on' : ''} style={{ height: 3 + i * 2 }} />
          ))}
        </span>
        {enLigne ? `${ping ?? '…'} ms` : 'Pas de connexion'}
      </span>
    </div>
  );
}

/** Compte actif dans la barre d'état : numéro, serveur et état de sa connexion (comptes en ligne). */
function IndicateurCompte() {
  const { compte, enLigne, ouvrir } = useTerminal();
  const statut = compte.enLigne ? enLigne.statut(compte.login) : null;
  const texte = !statut ? 'local' : compte.lecture && statut === 'connecte' ? 'lecture seule' : LIBELLE_STATUT[statut];
  const erreur = compte.enLigne ? enLigne.erreur(compte.login) : null;
  return (
    <button
      className={`be-compte ${statut ?? 'local'}`}
      title={`${compte.login} sur ${compte.serveur}${erreur ? ` — ${erreur}` : ''} : cliquez pour vous connecter à un compte`}
      onClick={() => ouvrir({ type: 'connexion', login: statut === 'deconnecte' ? compte.login : undefined })}
    >
      <i />
      {compte.login} · {compte.serveur} · {texte}
    </button>
  );
}

/** Sous-menu « Modèle » d'un graphique : appliquer, enregistrer, modèle par défaut, supprimer. */
export function menuModeles(etat: EtatTerminal, maj: (f: (e: EtatTerminal) => EtatTerminal) => void, g: Graphique): ElementMenu[] {
  return [
    ...etat.modeles.map((m) => ({
      libelle: m.nom,
      coche: etat.modeleDefaut === m.nom,
      action: () => maj((e) => ({ ...e, graphiques: e.graphiques.map((x) => (x.id === g.id ? { ...x, ...reglagesModele(m) } : x)) })),
    })),
    ...(etat.modeles.length ? [{ separateur: true } as ElementMenu] : []),
    {
      libelle: 'Enregistrer le modèle…',
      action: () => {
        const nom = demanderNom('Nom du modèle (type, couleurs, indicateurs, options et expert de ce graphique)', etat.modeles.length ? `Modèle ${etat.modeles.length + 1}` : 'Mon modèle');
        if (!nom) return;
        if (etat.modeles.some((m) => m.nom === nom) && !window.confirm(`Remplacer le modèle « ${nom} » ?`)) return;
        maj((e) => enregistrerModele(e, g, nom));
      },
    },
    {
      libelle: 'Modèle par défaut (nouveaux graphiques)',
      desactive: !etat.modeles.length,
      sousMenu: [
        { libelle: 'Aucun', coche: !etat.modeleDefaut, action: () => maj((e) => ({ ...e, modeleDefaut: null })) },
        ...etat.modeles.map((m) => ({ libelle: m.nom, coche: etat.modeleDefaut === m.nom, action: () => maj((e) => ({ ...e, modeleDefaut: m.nom })) })),
      ],
    },
    {
      libelle: 'Supprimer un modèle',
      desactive: !etat.modeles.length,
      sousMenu: etat.modeles.map((m) => ({
        libelle: m.nom,
        action: () => window.confirm(`Supprimer le modèle « ${m.nom} » ?`) && maj((e) => ({ ...e, modeles: e.modeles.filter((x) => x.nom !== m.nom), modeleDefaut: e.modeleDefaut === m.nom ? null : e.modeleDefaut })),
      })),
    },
  ];
}

/** Sous-menu « Profils » : charger, enregistrer, supprimer. */
function menuProfils(etat: EtatTerminal, maj: (f: (e: EtatTerminal) => EtatTerminal) => void): ElementMenu[] {
  return [
    ...etat.profils.map((p) => ({ libelle: `${p.nom} (${p.graphiques.length} graphique${p.graphiques.length > 1 ? 's' : ''})`, coche: etat.profilActif === p.nom, action: () => maj((e) => chargerProfil(e, p.nom)) })),
    ...(etat.profils.length ? [{ separateur: true } as ElementMenu] : []),
    {
      libelle: 'Enregistrer le profil…',
      action: () => {
        const nom = demanderNom('Nom du profil (tous les graphiques ouverts et leur disposition)', etat.profilActif ?? 'Mon profil');
        if (!nom) return;
        if (etat.profils.some((p) => p.nom === nom) && nom !== etat.profilActif && !window.confirm(`Remplacer le profil « ${nom} » ?`)) return;
        maj((e) => enregistrerProfil(e, nom));
      },
    },
    {
      libelle: 'Supprimer un profil',
      desactive: !etat.profils.length,
      sousMenu: etat.profils.map((p) => ({
        libelle: p.nom,
        action: () => window.confirm(`Supprimer le profil « ${p.nom} » ?`) && maj((e) => ({ ...e, profils: e.profils.filter((x) => x.nom !== p.nom), profilActif: e.profilActif === p.nom ? null : e.profilActif })),
      })),
    },
  ];
}
