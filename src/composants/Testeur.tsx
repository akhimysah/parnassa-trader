import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useTerminal } from '../contexte';
import { EXPERTS, definitionExpert, type TypeExpert } from '../algo/experts';
import { combinaisons, lancerTest, optimiser, type Modelisation, type Passe, type PlageOptimisation, type ResultatTest } from '../algo/testeur';
import { chargerHistoriqueLong, PERIODES, type Bougie, type Periode } from '../marche/bougies';
import { SYMBOLES, formaterPrix, point, symbole } from '../marche/symboles';
import { conversion } from '../compte/moteur';
import { CourbeSolde } from './Courbe';
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
}

const CLE = 'parnassa-trader:testeur';

function reglagesDefaut(): Reglages {
  return { expert: 'croisement-ma', symbole: 'EURUSD', periode: 'H1', barres: 3000, modelisation: 'ohlc', spreadActuel: true, spread: 12, depot: 10000, levier: 100, p: EXPERTS[0].defaut, optimiser: {}, critere: 'profit' };
}

function charger(): Reglages {
  try {
    const r = JSON.parse(localStorage.getItem(CLE) ?? 'null') as Reglages | null;
    return r && symbole(r.symbole) && EXPERTS.some((e) => e.type === r.expert) ? { ...reglagesDefaut(), ...r } : reglagesDefaut();
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
  const [resultat, setResultat] = useState<(ResultatTest & { reglages: Reglages; bougies: Bougie[] }) | null>(null);
  const [passes, setPasses] = useState<Passe[]>([]);
  const [journal, setJournal] = useState<string[]>([]);
  const annuler = useRef(false);
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
  });

  const plagesActives = Object.fromEntries(Object.entries(r.optimiser).filter(([, v]) => v.actif)) as Record<string, PlageOptimisation>;
  const jeux = useMemo(() => combinaisons(r.p, plagesActives), [r.p, JSON.stringify(plagesActives)]); // eslint-disable-line react-hooks/exhaustive-deps
  const optimisation = Object.keys(plagesActives).length > 0;

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
      if (!optimisation) {
        setEnCours({ texte: 'Test en cours…', fait: 0, total: 1 });
        await new Promise((ok) => setTimeout(ok, 20));
        const res = lancerTest(base(b));
        setResultat({ ...res, reglages, bougies: b });
        noter(`${def.nom} sur ${r.symbole},${r.periode} : ${res.stats.trades} trades, bénéfice net ${argent(res.stats.net)} USD, drawdown max ${res.stats.ddMaxPct.toFixed(2)} % (${res.barres} barres en ${Math.round(res.dureeMs)} ms)`);
        for (const j of res.journal.slice(0, 50)) noter(`${dateMT(j.t)} ${j.message}`);
        setOnglet('backtest');
      } else {
        noter(`optimisation de ${def.nom} : ${jeux.length} passes sur ${Object.keys(plagesActives).join(', ')}`);
        setPasses([]);
        setOnglet('optimisation');
        const debut = performance.now();
        const res = await optimiser(base(b), jeux, (fait, ps) => {
          setEnCours({ texte: `Optimisation : passe ${fait} / ${jeux.length}`, fait, total: jeux.length });
          setPasses([...ps]);
        }, () => annuler.current);
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
                    {EXPERTS.map((x) => (
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
                  <span className="testeur-info">{optimisation ? `${jeux.length} passes (onglet Entrées)` : 'désactivée — cochez des entrées à optimiser'}</span>
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
                  Compte {compte.type === 'raw' ? 'Raw : commission de 7 $ par lot aller-retour en forex et métaux' : 'Standard : sans commission'}. Profits en devise étrangère convertis au taux actuel, sans swap.
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
                  const o = r.optimiser[k] ?? { actif: false, debut: r.p[k], pas: k === 'volume' ? 0.01 : k === 'sl' || k === 'tp' ? 50 : 1, fin: r.p[k] * 2 || 100 };
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
          {onglet === 'optimisation' && (
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

function Backtest({ res }: { res: ResultatTest & { reglages: Reglages; bougies: Bougie[] } }) {
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
  return (
    <div className="testeur-backtest">
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

/** Bougies testées avec les entrées (flèches) et sorties (croix) de l'expert. */
function Visualisation({ res }: { res: ResultatTest & { reglages: Reglages; bougies: Bougie[] } }) {
  const ref = useRef<HTMLDivElement>(null);
  const { etat } = useTerminal();
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
    serie.setData(res.bougies.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    createSeriesMarkers<Time>(
      serie,
      [...res.marqueurs]
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          time: m.time as UTCTimestamp,
          position: m.entree ? (m.sens === 'buy' ? 'belowBar' : 'aboveBar') : m.sens === 'buy' ? 'belowBar' : 'aboveBar',
          shape: m.entree ? (m.sens === 'buy' ? 'arrowUp' : 'arrowDown') : 'circle',
          color: m.entree ? (m.sens === 'buy' ? '#1e6fd9' : '#e0393e') : '#f0a020',
          text: m.entree ? '' : m.texte === 'signal' ? '' : m.texte,
          size: m.entree ? 1 : 0.6,
        })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [res, etat.theme]);
  return <div ref={ref} className="testeur-visualisation" />;
}
