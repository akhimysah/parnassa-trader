import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useTerminal } from '../contexte';
import { tousExperts, EXPERTS, definitionExpert, type TypeExpert } from '../algo/experts';
import { combinaisons, lancerTest, nombreCombinaisons, optimiser, optimiserGenetique, type Modelisation, type Passe, type PlageOptimisation, type ResultatTest } from '../algo/testeur';
import { chargerHistoriqueLong, PERIODES, type Bougie, type Periode } from '../marche/bougies';
import { SYMBOLES, formaterPrix, point, symbole } from '../marche/symboles';
import { conversion } from '../compte/moteur';
import { CourbeSolde } from './Courbe';
import { enregistrerRapport, rapportHtml } from '../algo/rapportHtml';
import { Spin, argent, dateMT } from './ui';

type Onglet = 'parametres' | 'entrees' | 'backtest' | 'graphique' | 'visualisation' | 'trades' | 'optimisation' | 'journal';

interface Reglages {
  expert: TypeExpert;
  symbole: string;
  periode: Periode;
  barres: number;
  modelisation: Modelisation;
  spreadActuel: boolean;
  spread: number;
  depot: number;
  levier: number;
  p: Record<string, number>;
  optimiser: Record<string, PlageOptimisation & { actif: boolean }>;
  critere: 'profit' | 'facteur' | 'recouvrement' | 'sharpe' | 'dd';
  /** Avant-test (forward) : dernière fraction de l'historique gardée hors du test (0 = aucun, 2 = 1/2, 3 = 1/3, 4 = 1/4). */
  avant?: 0 | 2 | 3 | 4;
  /** Optimisation : toutes les combinaisons, ou algorithme génétique (indispensable au-delà de 2 000 combinaisons). */
  algorithme?: 'complet' | 'genetique';
}

const CLE = 'parnassa-trader:testeur';

function reglagesDefaut(): Reglages {
  return { expert: 'croisement-ma', symbole: 'EURUSD', periode: 'H1', barres: 3000, modelisation: 'ohlc', spreadActuel: true, spread: 12, depot: 10000, levier: 100, p: EXPERTS[0].defaut, optimiser: {}, critere: 'profit' };
}

function charger(): Reglages {
  try {
    const r = JSON.parse(localStorage.getItem(CLE) ?? 'null') as Reglages | null;
    // Entrées complétées par les valeurs par défaut (nouvelles entrées ajoutées depuis : stop suiveur, break-even).
    return r && symbole(r.symbole) && tousExperts().some((e) => e.type === r.expert) ? { ...reglagesDefaut(), ...r, p: { ...definitionExpert(r.expert).defaut, ...r.p } } : reglagesDefaut();
  } catch {
    return reglagesDefaut();
  }
}

/** Demande au testeur de se configurer pour un expert, un symbole et une période (depuis le Navigateur ou un graphique). */
export function preparerTest(d: { expert: TypeExpert; symbole: string; periode: Periode; p?: Record<string, number> }) {
  window.dispatchEvent(new CustomEvent('parnassa-testeur', { detail: d }));
}

const ONGLETS: [Onglet, string][] = [
  ['parametres', 'Paramètres'],
  ['entrees', 'Entrées'],
  ['backtest', 'Backtest'],
  ['graphique', 'Graphique'],
  ['visualisation', 'Visualisation'],
  ['trades', 'Trades'],
  ['optimisation', 'Optimisation'],
  ['journal', 'Journal'],
];

/** Testeur de stratégie (Ctrl+R) : backtest et optimisation des Expert Advisors sur l'historique. */
export function Testeur() {
  const { maj, cotations, etat, majGraphique, ouvrirGraphique, signaler, compte } = useTerminal();
  const [r, setR] = useState<Reglages>(charger);
  const [onglet, setOnglet] = useState<Onglet>('parametres');
  const [enCours, setEnCours] = useState<null | { texte: string; fait: number; total: number }>(null);
  const [resultat, setResultat] = useState<(ResultatTest & { reglages: Reglages; bougies: Bougie[]; avant?: ResultatTest & { bougies: Bougie[] } }) | null>(null);
  const [passes, setPasses] = useState<Passe[]>([]);
  const [journal, setJournal] = useState<string[]>([]);
  const annuler = useRef(false);
  const [vueOpti, setVueOpti] = useState<'tableau' | 'carte'>('tableau');
  const historique = useRef<{ cle: string; bougies: Bougie[] } | null>(null);
  const def = definitionExpert(r.expert);
  const s = symbole(r.symbole)!;
  const q = cotations[r.symbole];
  const spreadActuel = q ? Math.max(1, Math.round((q.ask - q.bid) / point(s))) : s.spread;

  useEffect(() => {
    try {
      localStorage.setItem(CLE, JSON.stringify(r));
    } catch {
      // stockage indisponible
    }
  }, [r]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ expert: TypeExpert; symbole: string; periode: Periode; p?: Record<string, number> }>).detail;
      setR((x) => ({ ...x, expert: d.expert, symbole: d.symbole, periode: d.periode, p: d.p ?? definitionExpert(d.expert).defaut, optimiser: {} }));
      setOnglet('parametres');
    };
    window.addEventListener('parnassa-testeur', h);
    return () => window.removeEventListener('parnassa-testeur', h);
  }, []);

  const noter = (m: string) => setJournal((j) => [...j, `${dateMT(Date.now())}  ${m}`].slice(-500));
  const changer = (patch: Partial<Reglages>) => setR((x) => ({ ...x, ...patch }));
  const changerExpert = (t: TypeExpert) => setR((x) => ({ ...x, expert: t, p: definitionExpert(t).defaut, optimiser: {} }));

  const bougies = async (): Promise<Bougie[]> => {
    const cle = `${r.symbole}|${r.periode}|${r.barres}`;
    if (historique.current?.cle === cle) return historique.current.bougies;
    noter(`${r.symbole},${r.periode} : chargement de l'historique (${r.barres} barres au plus)…`);
    const reference = q ? (q.bid + q.ask) / 2 : undefined;
    const b = await chargerHistoriqueLong(s, r.periode, r.barres, reference);
    historique.current = { cle, bougies: b };
    if (b.length) noter(`${r.symbole},${r.periode} : ${b.length} barres du ${dateMT(b[0].time * 1000, false)} au ${dateMT(b[b.length - 1].time * 1000, false)}`);
    return b;
  };

  const base = (b: Bougie[]) => ({
    s,
    expert: { type: r.expert, p: r.p, magic: 0 },
    bougies: b,
    depot: r.depot,
    levier: r.levier,
    spread: r.spreadActuel ? spreadActuel : r.spread,
    modelisation: r.modelisation,
    conversion: conversion(s, cotations),
    typeCompte: compte.type ?? 'standard',
    swaps: !compte.sansSwap,
  });

  const plagesActives = Object.fromEntries(Object.entries(r.optimiser).filter(([, v]) => v.actif)) as Record<string, PlageOptimisation>;
  const jeux = useMemo(() => combinaisons(r.p, plagesActives), [r.p, JSON.stringify(plagesActives)]); // eslint-disable-line react-hooks/exhaustive-deps
  const optimisation = Object.keys(plagesActives).length > 0;
  const totalCombinaisons = useMemo(() => nombreCombinaisons(plagesActives), [JSON.stringify(plagesActives)]); // eslint-disable-line react-hooks/exhaustive-deps
  const genetique = r.algorithme === 'genetique' || totalCombinaisons > 2000;
  /** Note d'une passe selon le critère choisi (une passe sans trade est la pire). */
  const noter_passe = (p: Passe) => {
    if (!p.trades) return -Infinity;
    if (r.critere === 'facteur') return p.facteur ?? 0;
    if (r.critere === 'recouvrement') return p.recouvrement ?? -Infinity;
    if (r.critere === 'sharpe') return p.sharpe ?? -Infinity;
    if (r.critere === 'dd') return -p.ddPct;
    return p.profit;
  };

  const demarrer = async () => {
    annuler.current = false;
    setEnCours({ texte: 'Chargement de l\'historique…', fait: 0, total: 1 });
    try {
      const b = await bougies();
      if (b.length < 50) {
        noter('historique insuffisant pour tester (moins de 50 barres)');
        signaler('Historique insuffisant pour ce symbole et cette période');
        return;
      }
      const reglages = { ...r };
      // Avant-test : la dernière fraction de l'historique n'est pas vue par le test (ni par l'optimisation),
      // puis l'expert y est rejoué ; les barres juste avant la coupure amorcent ses indicateurs.
      const coupe = r.avant ? b.length - Math.floor(b.length / r.avant) : b.length;
      const passe = b.slice(0, coupe);
      const amorce = Math.max(0, coupe - 400);
      const futur = r.avant ? b.slice(amorce) : [];
      const baseAvant = r.avant ? { ...base(futur), debut: coupe - amorce } : undefined;
      if (r.avant) noter(`avant-test : ${passe.length} barres de test, ${b.length - coupe} barres d'avant-test à partir du ${dateMT(b[coupe].time * 1000, false)}`);
      if (!optimisation) {
        setEnCours({ texte: 'Test en cours…', fait: 0, total: 1 });
        await new Promise((ok) => setTimeout(ok, 20));
        const res = lancerTest(base(passe));
        const resAvant = baseAvant ? lancerTest(baseAvant) : undefined;
        setResultat({ ...res, reglages, bougies: passe, avant: resAvant ? { ...resAvant, bougies: b.slice(coupe) } : undefined });
        noter(`${def.nom} sur ${r.symbole},${r.periode} : ${res.stats.trades} trades, bénéfice net ${argent(res.stats.net)} USD, drawdown max ${res.stats.ddMaxPct.toFixed(2)} % (${res.barres} barres en ${Math.round(res.dureeMs)} ms)`);
        if (resAvant) noter(`avant-test : ${resAvant.stats.trades} trades, bénéfice net ${argent(resAvant.stats.net)} USD, drawdown max ${resAvant.stats.ddMaxPct.toFixed(2)} %`);
        for (const j of res.journal.slice(0, 50)) noter(`${dateMT(j.t)} ${j.message}`);
        setOnglet('backtest');
      } else {
        setPasses([]);
        setOnglet('optimisation');
        const debut = performance.now();
        if (genetique) {
          noter(`optimisation génétique de ${def.nom} : ${totalCombinaisons.toLocaleString('fr-FR')} combinaisons possibles sur ${Object.keys(plagesActives).join(', ')}`);
          const res = await optimiserGenetique(
            base(passe),
            plagesActives,
            noter_passe,
            (fait, total, ps) => {
              setEnCours({ texte: `Optimisation génétique : ${fait} passes`, fait, total });
              setPasses([...ps]);
            },
            () => annuler.current,
            baseAvant,
          );
          setPasses(res);
          noter(`optimisation génétique terminée : ${res.length} passes testées en ${((performance.now() - debut) / 1000).toFixed(1)} s${annuler.current ? ' (interrompue)' : ''}`);
          return;
        }
        noter(`optimisation de ${def.nom} : ${jeux.length} passes sur ${Object.keys(plagesActives).join(', ')}`);
        const res = await optimiser(
          base(passe),
          jeux,
          (fait, ps) => {
            setEnCours({ texte: `Optimisation : passe ${fait} / ${jeux.length}`, fait, total: jeux.length });
            setPasses([...ps]);
          },
          () => annuler.current,
          baseAvant,
        );
        setPasses(res);
        noter(`optimisation terminée : ${res.length} passes en ${((performance.now() - debut) / 1000).toFixed(1)} s${annuler.current ? ' (interrompue)' : ''}`);
      }
    } catch (e) {
      noter(`erreur : ${(e as Error).message}`);
      signaler('Historique indisponible pour ce symbole');
    } finally {
      setEnCours(null);
    }
  };

  const tri = (a: Passe, b: Passe) => {
    if (r.critere === 'facteur') return (b.facteur ?? 0) - (a.facteur ?? 0);
    if (r.critere === 'recouvrement') return (b.recouvrement ?? -Infinity) - (a.recouvrement ?? -Infinity);
    if (r.critere === 'sharpe') return (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity);
    if (r.critere === 'dd') return a.ddPct - b.ddPct;
    return b.profit - a.profit;
  };

  const appliquer = () => {
    // Attache l'expert testé, avec ses entrées, à un graphique du symbole et de la période testés.
    const g = etat.graphiques.find((x) => x.symbole === r.symbole && x.periode === r.periode);
    const expert = { type: r.expert, p: r.p, magic: 100000 + Math.floor(Math.random() * 900000) };
    if (g) majGraphique(g.id, { expert });
    else {
      ouvrirGraphique(r.symbole, r.periode);
      // Le nouveau graphique devient le graphique actif : on lui attache l'expert juste après sa création.
      setTimeout(() => maj((e) => ({ ...e, graphiques: e.graphiques.map((x) => (x.id === e.graphiqueActif ? { ...x, expert } : x)) })), 0);
    }
    signaler(`${def.nom} attaché à ${r.symbole},${r.periode} (activez l'Algo Trading pour qu'il trade)`);
  };

  const fermer = () => maj((e) => ({ ...e, panneaux: { ...e.panneaux, testeur: false } }));

  return (
    <div className="panneau boite testeur">
      <div className="boite-poignee">
        <button onClick={fermer} aria-label="Fermer le testeur">
          ✕
        </button>
        <span>Testeur de stratégie</span>
      </div>
      <div className="boite-contenu">
        <div className="panneau-corps">
          {onglet === 'parametres' && (
            <div className="testeur-parametres">
              <div className="formulaire testeur-colonne">
                <label>
                  <span>Expert :</span>
                  <select value={r.expert} onChange={(e) => changerExpert(e.target.value as TypeExpert)}>
                    {tousExperts().map((x) => (
                      <option key={x.type} value={x.type}>
                        {x.nom}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Symbole :</span>
                  <select value={r.symbole} onChange={(e) => changer({ symbole: e.target.value })}>
                    {SYMBOLES.map((x) => (
                      <option key={x.nom} value={x.nom}>
                        {x.nom}, {x.description}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Période :</span>
                  <select value={r.periode} onChange={(e) => changer({ periode: e.target.value as Periode })}>
                    {PERIODES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id} — {p.libelle}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Historique :</span>
                  <select value={r.barres} onChange={(e) => changer({ barres: Number(e.target.value) })}>
                    {[500, 1000, 2000, 3000, 5000, 10000].map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString('fr-FR')} dernières barres
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Modélisation :</span>
                  <select value={r.modelisation} onChange={(e) => changer({ modelisation: e.target.value as Modelisation })}>
                    <option value="ohlc">OHLC de chaque barre (SL/TP dans la barre)</option>
                    <option value="ouverture">Prix d'ouverture uniquement (rapide)</option>
                  </select>
                </label>
              </div>
              <div className="formulaire testeur-colonne">
                <label>
                  <span>Spread :</span>
                  <select value={r.spreadActuel ? 'actuel' : 'fixe'} onChange={(e) => changer({ spreadActuel: e.target.value === 'actuel' })}>
                    <option value="actuel">Actuel ({spreadActuel} points)</option>
                    <option value="fixe">Fixe</option>
                  </select>
                </label>
                {!r.spreadActuel && (
                  <label>
                    <span>Points :</span>
                    <Spin valeur={r.spread} changer={(v) => changer({ spread: v })} pas={1} min={0} decimales={0} />
                  </label>
                )}
                <label>
                  <span>Dépôt :</span>
                  <Spin valeur={r.depot} changer={(v) => changer({ depot: v })} pas={1000} min={100} decimales={0} />
                </label>
                <label>
                  <span>Levier :</span>
                  <select value={r.levier} onChange={(e) => changer({ levier: Number(e.target.value) })}>
                    {[1, 10, 30, 50, 100, 200, 500, 1000].map((v) => (
                      <option key={v} value={v}>
                        1:{v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Optimisation :</span>
                  <span className="testeur-info">
                    {optimisation ? `${totalCombinaisons.toLocaleString('fr-FR')} combinaisons (onglet Entrées)` : 'désactivée — cochez des entrées à optimiser'}
                  </span>
                </label>
                {optimisation && (
                  <label>
                    <span>Algorithme :</span>
                    <select value={genetique ? 'genetique' : 'complet'} disabled={totalCombinaisons > 2000} onChange={(e) => changer({ algorithme: e.target.value as Reglages['algorithme'] })} title={totalCombinaisons > 2000 ? 'Au-delà de 2 000 combinaisons, seul l’algorithme génétique est possible' : undefined}>
                      <option value="complet">Complet (toutes les combinaisons)</option>
                      <option value="genetique">Génétique rapide</option>
                    </select>
                  </label>
                )}
                <label>
                  <span>Avant-test :</span>
                  <select value={r.avant ?? 0} onChange={(e) => changer({ avant: Number(e.target.value) as Reglages['avant'] })} title="Garde la fin de l'historique hors du test pour vérifier l'expert sur des données qu'il n'a pas vues">
                    <option value={0}>Non</option>
                    <option value={2}>1/2 de l'historique</option>
                    <option value={3}>1/3 de l'historique</option>
                    <option value={4}>1/4 de l'historique</option>
                  </select>
                </label>
                {optimisation && (
                  <label>
                    <span>Critère :</span>
                    <select value={r.critere} onChange={(e) => changer({ critere: e.target.value as Reglages['critere'] })}>
                      <option value="profit">Bénéfice net maximal</option>
                      <option value="facteur">Facteur de profit maximal</option>
                      <option value="recouvrement">Facteur de récupération maximal</option>
                      <option value="sharpe">Ratio de Sharpe maximal</option>
                      <option value="dd">Drawdown minimal</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="testeur-actions">
                <p className="aide">{def.description}</p>
                {enCours ? (
                  <>
                    <div className="progression">
                      <div style={{ width: `${(enCours.fait / Math.max(1, enCours.total)) * 100}%` }} />
                      <span>{enCours.texte}</span>
                    </div>
                    <button onClick={() => (annuler.current = true)}>Arrêter</button>
                  </>
                ) : (
                  <button className="demarrer" onClick={() => void demarrer()}>
                    ▶ Démarrer
                  </button>
                )}
                {resultat && !enCours && (
                  <button onClick={appliquer} title="Attache l'expert avec ces entrées à un graphique">
                    Attacher au graphique
                  </button>
                )}
                <p className="aide">
                  Compte {compte.type === 'raw' ? 'Raw : commission de 7 $ par lot aller-retour en forex et métaux' : 'Standard : sans commission'}. Swaps {compte.sansSwap ? 'désactivés (compte sans swap)' : 'comptés à chaque rollover'}. Profits en devise étrangère convertis au taux actuel.
                </p>
              </div>
            </div>
          )}
          {onglet === 'entrees' && (
            <table className="table boite-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Valeur</th>
                  <th>Optimiser</th>
                  <th>Début</th>
                  <th>Pas</th>
                  <th>Fin</th>
                  <th className="d">Valeurs</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(def.defaut).map((k) => {
                  const o = r.optimiser[k] ?? { actif: false, debut: r.p[k], pas: k === 'volume' ? 0.01 : k === 'sl' || k === 'tp' || k === 'suiveur' || k === 'equilibre' ? 50 : 1, fin: r.p[k] * 2 || 100 };
                  const dec = k === 'volume' ? 2 : 0;
                  const majO = (patch: Partial<typeof o>) => changer({ optimiser: { ...r.optimiser, [k]: { ...o, ...patch } } });
                  const nb = o.pas > 0 ? Math.max(0, Math.floor((o.fin - o.debut) / o.pas + 1e-9) + 1) : 0;
                  return (
                    <tr key={k}>
                      <td>{def.libelles[k]}</td>
                      <td>
                        <Spin valeur={r.p[k]} changer={(v) => changer({ p: { ...r.p, [k]: v } })} pas={k === 'volume' ? 0.01 : 1} min={k === 'volume' ? 0.01 : 0} decimales={dec} />
                      </td>
                      <td>
                        <input type="checkbox" checked={o.actif} onChange={() => majO({ actif: !o.actif })} />
                      </td>
                      <td>
                        <Spin valeur={o.debut} changer={(v) => majO({ debut: v })} pas={k === 'volume' ? 0.01 : 1} decimales={dec} />
                      </td>
                      <td>
                        <Spin valeur={o.pas} changer={(v) => majO({ pas: v })} pas={k === 'volume' ? 0.01 : 1} min={0} decimales={dec} />
                      </td>
                      <td>
                        <Spin valeur={o.fin} changer={(v) => majO({ fin: v })} pas={k === 'volume' ? 0.01 : 1} decimales={dec} />
                      </td>
                      <td className="d muet">{o.actif ? nb : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {onglet === 'backtest' && (resultat ? <Backtest res={resultat} /> : <div className="vide-boite">Lancez un test depuis l'onglet Paramètres.</div>)}
          {onglet === 'graphique' &&
            (resultat ? (
              <div className="testeur-graphique">
                <div className="legende-courbes">
                  <span className="bleu">■ Solde</span> <span className="vert">■ Fonds propres</span>
                </div>
                <CourbeSolde points={resultat.stats.courbe} fonds={resultat.fonds} hauteur={Math.max(140, etat.hauteurBoite - 70)} />
              </div>
            ) : (
              <div className="vide-boite">Aucun résultat.</div>
            ))}
          {onglet === 'visualisation' && (resultat ? <Visualisation res={resultat} /> : <div className="vide-boite">Aucun résultat.</div>)}
          {onglet === 'trades' && (resultat ? <Trades res={resultat} /> : <div className="vide-boite">Aucun résultat.</div>)}
          {onglet === 'optimisation' && Object.keys(plagesActives).length >= 2 && passes.length > 0 && (
            <div className="vue-optimisation">
              <button className={vueOpti === 'tableau' ? 'actif' : ''} onClick={() => setVueOpti('tableau')}>
                Tableau
              </button>
              <button className={vueOpti === 'carte' ? 'actif' : ''} onClick={() => setVueOpti('carte')}>
                Carte 2D
              </button>
            </div>
          )}
          {onglet === 'optimisation' && vueOpti === 'carte' && Object.keys(plagesActives).length >= 2 && passes.length > 0 && (
            <CarteOptimisation
              passes={passes}
              plages={plagesActives}
              note={noter_passe}
              choisir={(p) => {
                setR((x) => ({ ...x, p: p.p, optimiser: Object.fromEntries(Object.entries(x.optimiser).map(([k, v]) => [k, { ...v, actif: false }])) }));
                setOnglet('parametres');
                signaler('Entrées de la passe appliquées : cliquez sur Démarrer pour la rejouer');
              }}
            />
          )}
          {onglet === 'optimisation' && !(vueOpti === 'carte' && Object.keys(plagesActives).length >= 2 && passes.length > 0) && (
            <table className="table boite-table">
              <thead>
                <tr>
                  <th>Passe</th>
                  <th className="d">Bénéfice</th>
                  <th className="d">Trades</th>
                  <th className="d">Facteur de profit</th>
                  <th className="d">Gain espéré</th>
                  <th className="d">Facteur de récup.</th>
                  <th className="d">Sharpe</th>
                  <th className="d">Drawdown %</th>
                  {passes.some((p) => p.avant) && (
                    <>
                      <th className="d avant">Avant-test bénéfice</th>
                      <th className="d avant">Avant-test PF</th>
                      <th className="d avant">Avant-test DD %</th>
                    </>
                  )}
                  {Object.keys(plagesActives).map((k) => (
                    <th key={k} className="d">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...passes].sort(tri).map((p) => (
                  <tr
                    key={p.numero}
                    title="Double-cliquez pour rejouer cette passe en test unique"
                    onDoubleClick={() => {
                      setR((x) => ({ ...x, p: p.p, optimiser: Object.fromEntries(Object.entries(x.optimiser).map(([k, v]) => [k, { ...v, actif: false }])) }));
                      setOnglet('parametres');
                      signaler('Entrées de la passe appliquées : cliquez sur Démarrer pour la rejouer');
                    }}
                  >
                    <td>{p.numero}</td>
                    <td className={`d gras ${p.profit >= 0 ? 'positif' : 'negatif'}`}>{argent(p.profit)}</td>
                    <td className="d">{p.trades}</td>
                    <td className="d">{p.facteur === null ? '—' : p.facteur.toFixed(2)}</td>
                    <td className="d">{argent(p.esperance)}</td>
                    <td className="d">{p.recouvrement === null ? '—' : p.recouvrement.toFixed(2)}</td>
                    <td className="d">{p.sharpe === null ? '—' : p.sharpe.toFixed(2)}</td>
                    <td className="d">{p.ddPct.toFixed(2)}</td>
                    {p.avant && (
                      <>
                        <td className={`d gras avant ${p.avant.profit >= 0 ? 'positif' : 'negatif'}`}>{argent(p.avant.profit)}</td>
                        <td className="d avant">{p.avant.facteur === null ? '—' : p.avant.facteur.toFixed(2)}</td>
                        <td className="d avant">{p.avant.ddPct.toFixed(2)}</td>
                      </>
                    )}
                    {Object.keys(plagesActives).map((k) => (
                      <td key={k} className="d">
                        {p.p[k]}
                      </td>
                    ))}
                  </tr>
                ))}
                {passes.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muet">
                      Cochez « Optimiser » sur une ou plusieurs entrées, puis Démarrer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {onglet === 'journal' && (
            <div className="testeur-journal">
              {journal.length === 0 ? <div className="vide-boite">Journal vide.</div> : journal.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
        <div className="onglets-bas">
          {ONGLETS.map(([id, l]) => (
            <button key={id} className={onglet === id ? 'actif' : ''} onClick={() => setOnglet(id)}>
              {l}
            </button>
          ))}
          {enCours && <span className="om-compte">{enCours.texte}</span>}
        </div>
      </div>
    </div>
  );
}

function Backtest({ res }: { res: ResultatTest & { reglages: Reglages; bougies: Bougie[]; avant?: ResultatTest & { bougies: Bougie[] } } }) {
  const s = res.stats;
  const r = res.reglages;
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)} %` : '—');
  const signe = (v: number) => (v > 0 ? 'positif' : v < 0 ? 'negatif' : '');
  const lignes: [string, string, string?][][] = [
    [
      ['Expert', `${definitionExpert(r.expert).nom}`],
      ['Symbole / période', `${r.symbole}, ${r.periode}`],
      ['Intervalle', res.bougies.length ? `${dateMT(res.bougies[0].time * 1000, false)} – ${dateMT(res.bougies[res.bougies.length - 1].time * 1000, false)}` : '—'],
      ['Barres', String(res.barres)],
      ['Entrées', Object.entries(r.p).map(([k, v]) => `${k}=${v}`).join(', ')],
      ['Dépôt initial', argent(r.depot)],
      ['Levier', `1:${r.levier}`],
    ],
    [
      ['Bénéfice net', argent(s.net), signe(s.net)],
      ['Profit brut', argent(s.brutGain), 'positif'],
      ['Perte brute', argent(s.brutPerte), 'negatif'],
      ['Facteur de profit', s.facteur === null ? '—' : s.facteur.toFixed(2)],
      ['Gain espéré', argent(s.esperance), signe(s.esperance)],
      ['Facteur de récupération', s.recouvrement === null ? '—' : s.recouvrement.toFixed(2)],
      ['Ratio de Sharpe', s.sharpe === null ? '—' : s.sharpe.toFixed(2)],
    ],
    [
      ['Drawdown absolu du solde', argent(s.ddAbsolu)],
      ['Drawdown maximal du solde', `${argent(s.ddMax)} (${s.ddMaxPct.toFixed(2)} %)`, 'negatif'],
      ['Trades au total', String(s.trades)],
      ['Positions longues (% gagnantes)', `${s.longs} (${pct(s.longsGagnants, s.longs)})`],
      ['Positions courtes (% gagnantes)', `${s.courts} (${pct(s.courtsGagnants, s.courts)})`],
      ['Trades gagnants', `${s.gagnants} (${pct(s.gagnants, s.trades)})`],
      ['Plus gros gain / plus grosse perte', `${argent(s.plusGrosGain)} / ${argent(s.plusGrossePerte)}`],
    ],
  ];
  const enregistrer = () =>
    void enregistrerRapport(
      `StrategyTester-${definitionExpert(r.expert).nom.replace(/\W+/g, '_')}-${r.symbole}-${r.periode}.html`,
      rapportHtml({ titre: `Testeur de stratégie — ${definitionExpert(r.expert).nom}`, lignes: lignes[0].map(([l, v]) => [l, v] as [string, string]) }, res.transactions),
    );
  return (
    <div className="testeur-backtest">
      <button className="testeur-rapport" onClick={enregistrer} title="Enregistrer le rapport du test en HTML">
        Enregistrer le rapport
      </button>
      {res.avant && <ComparaisonAvant test={res} avant={res.avant} />}
      {lignes.map((col, i) => (
        <table key={i} className="table specification">
          <tbody>
            {col.map(([l, v, c]) => (
              <tr key={l}>
                <td>{l}</td>
                <td className={`d ${c ?? ''}`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function Trades({ res }: { res: ResultatTest & { reglages: Reglages } }) {
  const s = symbole(res.reglages.symbole);
  return (
    <table className="table boite-table">
      <thead>
        <tr>
          <th>Heure</th>
          <th>Transaction</th>
          <th>Type</th>
          <th>Direction</th>
          <th className="d">Volume</th>
          <th className="d">Prix</th>
          <th className="d">S / L</th>
          <th className="d">T / P</th>
          <th className="d">Profit</th>
          <th className="d">Solde</th>
          <th>Commentaire</th>
        </tr>
      </thead>
      <tbody>
        {res.transactions.map((d) => (
          <tr key={d.ticket}>
            <td>{dateMT(d.heure, false)}</td>
            <td>{d.ticket}</td>
            <td className={d.type}>{d.type}</td>
            <td>{d.entree}</td>
            <td className="d">{d.volume ? d.volume.toFixed(2) : ''}</td>
            <td className="d">{d.prix ? formaterPrix(s, d.prix) : ''}</td>
            <td className="d">{d.sl ? formaterPrix(s, d.sl) : ''}</td>
            <td className="d">{d.tp ? formaterPrix(s, d.tp) : ''}</td>
            <td className={`d ${d.profit > 0 ? 'positif' : d.profit < 0 ? 'negatif' : ''}`}>{d.entree === 'in' ? '' : argent(d.profit)}</td>
            <td className="d">{argent(d.solde)}</td>
            <td>{d.commentaire}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const VITESSES = [1, 5, 20, 100, 500];

/**
 * Bougies testées avec les entrées (flèches) et sorties (ronds) de l'expert, et mode visuel comme le testeur de
 * MT5 : le test se rejoue barre après barre, avec lecture, pause, vitesse et curseur ; solde et fonds propres suivent.
 */
function Visualisation({ res }: { res: ResultatTest & { reglages: Reglages; bougies: Bougie[] } }) {
  const ref = useRef<HTMLDivElement>(null);
  const { etat } = useTerminal();
  const n = res.bougies.length;
  const [pos, setPos] = useState(n);
  const [lecture, setLecture] = useState(false);
  const [vitesse, setVitesse] = useState(20);
  const graphique = useRef<{ serie: ISeriesApi<'Candlestick'>; marqueurs: ISeriesMarkersPluginApi<Time>; affiche: number; chart: IChartApi } | null>(null);
  const marqueurs = useMemo(
    () =>
      [...res.marqueurs]
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          time: m.time as UTCTimestamp,
          position: (m.sens === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
          shape: (m.entree ? (m.sens === 'buy' ? 'arrowUp' : 'arrowDown') : 'circle') as 'arrowUp' | 'arrowDown' | 'circle',
          color: m.entree ? (m.sens === 'buy' ? '#1e6fd9' : '#e0393e') : '#f0a020',
          text: m.entree ? '' : m.texte === 'signal' ? '' : m.texte,
          size: m.entree ? 1 : 0.6,
        })),
    [res],
  );
  const vers = (b: Bougie) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close });

  useEffect(() => {
    const el = ref.current!;
    const sombre = etat.theme === 'sombre';
    const s = symbole(res.reglages.symbole)!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: sombre ? '#151924' : '#ffffff' }, textColor: sombre ? '#c8ccd6' : '#323232', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: sombre ? '#232836' : '#eee' }, horzLines: { color: sombre ? '#232836' : '#eee' } },
      timeScale: { timeVisible: true },
    });
    const serie = chart.addSeries(CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350', priceFormat: { type: 'price', precision: s.chiffres, minMove: point(s) } });
    graphique.current = { serie, marqueurs: createSeriesMarkers<Time>(serie, []), affiche: 0, chart };
    return () => {
      graphique.current = null;
      chart.remove();
    };
  }, [res, etat.theme]);

  // Affichage jusqu'à la barre `pos` : ajout barre par barre pendant la lecture, sinon tout redessiné.
  useEffect(() => {
    const g = graphique.current;
    if (!g) return;
    const fin = res.bougies[Math.max(0, pos - 1)]?.time ?? 0;
    if (pos > g.affiche && pos - g.affiche <= 50 && g.affiche > 0) {
      for (let i = g.affiche; i < pos; i++) g.serie.update(vers(res.bougies[i]));
    } else {
      g.serie.setData(res.bougies.slice(0, pos).map(vers));
      if (pos === n) g.chart.timeScale().fitContent();
      else {
        // Rejeu : largeur de barre lisible, les dernières barres collées au bord droit comme en direct.
        g.chart.timeScale().applyOptions({ barSpacing: 8 });
        g.chart.timeScale().scrollToRealTime();
      }
    }
    g.affiche = pos;
    g.marqueurs.setMarkers(marqueurs.filter((m) => m.time <= fin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, res, marqueurs, etat.theme]);

  // Lecture : `vitesse` barres par seconde, par pas de 50 ms au plus.
  useEffect(() => {
    if (!lecture) return;
    const pas = Math.max(1, Math.round(vitesse / 20));
    const t = window.setInterval(
      () =>
        setPos((p) => {
          if (p >= n) {
            setLecture(false);
            return n;
          }
          return Math.min(n, p + pas);
        }),
      Math.max(50, 1000 / vitesse),
    );
    return () => window.clearInterval(t);
  }, [lecture, vitesse, n]);

  // Solde, fonds propres et positions ouvertes à la barre affichée.
  const t = (res.bougies[Math.max(0, pos - 1)]?.time ?? 0) * 1000;
  const fonds = pos >= 2 ? res.fonds[Math.min(res.fonds.length - 1, pos - 2)]?.v : res.reglages.depot;
  const passees = res.transactions.filter((x) => x.heure <= t);
  const solde = passees.length ? passees[passees.length - 1].solde : res.reglages.depot;
  const ouvertes = passees.filter((x) => x.entree === 'in').length - passees.filter((x) => x.entree === 'out').length;
  const debutLecture = () => {
    if (pos >= n) setPos(Math.min(n, 60));
    setLecture(true);
  };
  return (
    <div className="testeur-visuel">
      <div className="testeur-lecteur">
        <button title="Début" onClick={() => (setLecture(false), setPos(Math.min(n, 60)))}>
          ⏮
        </button>
        {lecture ? (
          <button title="Pause" onClick={() => setLecture(false)}>
            ⏸
          </button>
        ) : (
          <button title="Lecture" onClick={debutLecture}>
            ▶
          </button>
        )}
        <button title="Barre suivante" onClick={() => (setLecture(false), setPos((p) => Math.min(n, p + 1)))}>
          ⏵|
        </button>
        <button title="Fin" onClick={() => (setLecture(false), setPos(n))}>
          ⏭
        </button>
        <input type="range" min={1} max={n} value={pos} onChange={(e) => (setLecture(false), setPos(Number(e.target.value)))} />
        <select value={vitesse} onChange={(e) => setVitesse(Number(e.target.value))} title="Vitesse (barres par seconde)">
          {VITESSES.map((v) => (
            <option key={v} value={v}>
              ×{v}
            </option>
          ))}
        </select>
        <span className="testeur-lecteur-infos">
          {t ? dateMT(t) : ''} · Solde <b>{argent(solde)}</b> · Fonds propres <b className={fonds !== undefined && fonds < solde ? 'negatif' : ''}>{argent(fonds ?? solde)}</b> · {ouvertes} position(s)
        </span>
      </div>
      <div ref={ref} className="testeur-visualisation" />
    </div>
  );
}

/** Test et avant-test côte à côte : une stratégie robuste garde des résultats proches sur les données non vues. */
function ComparaisonAvant({ test, avant }: { test: ResultatTest & { bougies: Bougie[] }; avant: ResultatTest & { bougies: Bougie[] } }) {
  const lignes: [string, (s: ResultatTest['stats']) => string][] = [
    ['Bénéfice net', (s) => argent(s.net)],
    ['Trades', (s) => String(s.trades)],
    ['Gagnants', (s) => (s.trades ? `${((s.gagnants / s.trades) * 100).toFixed(1)} %` : '—')],
    ['Facteur de profit', (s) => (s.facteur === null ? '—' : s.facteur.toFixed(2))],
    ['Gain espéré', (s) => argent(s.esperance)],
    ['Drawdown max', (s) => `${s.ddMaxPct.toFixed(2)} %`],
  ];
  const periode = (b: Bougie[]) => (b.length ? `${dateMT(b[0].time * 1000, false)} – ${dateMT(b[b.length - 1].time * 1000, false)}` : '—');
  return (
    <table className="table specification comparaison-avant">
      <thead>
        <tr>
          <th />
          <th className="d">Test</th>
          <th className="d avant">Avant-test</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Période</td>
          <td className="d">{periode(test.bougies)}</td>
          <td className="d avant">{periode(avant.bougies)}</td>
        </tr>
        {lignes.map(([l, f]) => (
          <tr key={l}>
            <td>{l}</td>
            <td className="d">{f(test.stats)}</td>
            <td className={`d avant ${l === 'Bénéfice net' ? (avant.stats.net >= 0 ? 'positif' : 'negatif') : ''}`}>{f(avant.stats)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Carte 2D de l'optimisation (comme le « graphique d'optimisation » de MT5) : les deux premières entrées optimisées en
 * axes, chaque case colorée selon le critère (vert = meilleur, rouge = pire, gris = non testée). Clic : rejouer la passe.
 */
function CarteOptimisation({ passes, plages, note, choisir }: { passes: Passe[]; plages: Record<string, PlageOptimisation>; note: (p: Passe) => number; choisir: (p: Passe) => void }) {
  const [kx, ky] = Object.keys(plages);
  const axe = (k: string) => {
    const pl = plages[k];
    const n = Math.min(60, Math.floor((pl.fin - pl.debut) / pl.pas + 1e-9) + 1);
    const pas = ((pl.fin - pl.debut) / Math.max(1, n - 1)) || pl.pas;
    return { n, val: (i: number) => pl.debut + i * pas, idx: (v: number) => Math.round((v - pl.debut) / pas) };
  };
  const X = axe(kx);
  const Y = axe(ky);
  // Meilleure passe de chaque case (les autres entrées optimisées peuvent varier).
  const cases = new Map<string, Passe>();
  for (const p of passes) {
    const k = `${X.idx(p.p[kx])},${Y.idx(p.p[ky])}`;
    const actuelle = cases.get(k);
    if (!actuelle || note(p) > note(actuelle)) cases.set(k, p);
  }
  const notes = [...cases.values()].map(note).filter(Number.isFinite);
  const min = Math.min(...notes);
  const max = Math.max(...notes);
  const couleur = (v: number) => {
    if (!Number.isFinite(v)) return '#9a9a9a55';
    const t = max > min ? (v - min) / (max - min) : 0.5;
    return `hsl(${Math.round(t * 120)}, 70%, 45%)`;
  };
  const [survol, setSurvol] = useState<Passe | null>(null);
  return (
    <div className="carte-optimisation">
      <div className="carte-info">
        {survol ? (
          <>
            {kx} = <b>{survol.p[kx]}</b>, {ky} = <b>{survol.p[ky]}</b> · bénéfice <b className={survol.profit >= 0 ? 'positif' : 'negatif'}>{argent(survol.profit)}</b> · {survol.trades} trades · PF {survol.facteur === null ? '—' : survol.facteur.toFixed(2)} · DD {survol.ddPct.toFixed(2)} %
          </>
        ) : (
          <>
            Axe horizontal : <b>{kx}</b> · axe vertical : <b>{ky}</b> · couleur : critère d'optimisation (vert = meilleur). Cliquez une case pour rejouer la passe.
          </>
        )}
      </div>
      <div className="carte-grille" style={{ gridTemplateColumns: `40px repeat(${X.n}, 1fr)` }} onMouseLeave={() => setSurvol(null)}>
        {Array.from({ length: Y.n }, (_, jj) => {
          const j = Y.n - 1 - jj;
          return [
            <div key={`y${j}`} className="carte-axe">
              {jj % Math.ceil(Y.n / 8) === 0 ? Number(Y.val(j).toFixed(4)) : ''}
            </div>,
            ...Array.from({ length: X.n }, (_, i) => {
              const p = cases.get(`${i},${j}`);
              return <div key={`${i},${j}`} className="carte-case" style={{ background: p ? couleur(note(p)) : 'transparent' }} onMouseEnter={() => setSurvol(p ?? null)} onClick={() => p && choisir(p)} />;
            }),
          ];
        })}
        <div />
        {Array.from({ length: X.n }, (_, i) => (
          <div key={`x${i}`} className="carte-axe bas">
            {i % Math.ceil(X.n / 8) === 0 ? Number(X.val(i).toFixed(4)) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
