import { useEffect, useMemo, useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { EXPERTS, definitionExpert, type TypeExpert } from '../algo/experts';
import { profitPosition, type Compte } from '../compte/moteur';
import { Fenetre, Spin, argent, dateMT } from './ui';

/** Attacher un Expert Advisor au graphique et régler ses paramètres (onglet « Entrées » de MT5). */
export function DialogueExpert({ graphique, expert }: { graphique: string; expert?: TypeExpert }) {
  const { etat, maj, majGraphique, fermer, compte, cotations } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  const [type, setType] = useState<TypeExpert>(expert ?? g?.expert?.type ?? 'croisement-ma');
  const def = definitionExpert(type);
  const [p, setP] = useState<Record<string, number>>(g?.expert?.type === type ? g.expert.p : def.defaut);
  useEffect(() => {
    setP(g?.expert?.type === type ? g.expert.p : definitionExpert(type).defaut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
  if (!g) {
    return (
      <Fenetre titre="Expert Advisor" fermer={fermer}>
        <p>Ouvrez d'abord un graphique.</p>
      </Fenetre>
    );
  }
  const actuel = g.expert;
  const ouvertes = actuel ? compte.positions.filter((x) => x.magic === actuel.magic) : [];
  const flottant = ouvertes.reduce((s, x) => s + profitPosition(x, cotations), 0);
  const pas = (k: string) => (k === 'volume' ? 0.01 : k === 'sl' || k === 'tp' ? 10 : 1);
  return (
    <Fenetre titre={`Expert Advisor — ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={480}>
      <div className="formulaire">
        <label>
          <span>Expert :</span>
          <select value={type} onChange={(e) => setType(e.target.value as TypeExpert)}>
            {EXPERTS.map((x) => (
              <option key={x.type} value={x.type}>
                {x.nom}
              </option>
            ))}
          </select>
        </label>
        <p className="aide">{def.description}</p>
        <fieldset>
          <legend>Entrées</legend>
          {Object.keys(def.defaut).map((k) => (
            <label key={k}>
              <span>{def.libelles[k]} :</span>
              <Spin valeur={p[k] ?? def.defaut[k]} changer={(v) => setP({ ...p, [k]: v })} pas={pas(k)} min={k === 'volume' ? 0.01 : 0} decimales={k === 'volume' ? 2 : 0} />
            </label>
          ))}
        </fieldset>
        <label className="case">
          <input type="checkbox" checked={etat.algo} onChange={() => maj((e) => ({ ...e, algo: !e.algo }))} />
          Autoriser l'Algo Trading (tous les experts du terminal)
        </label>
        <p className="aide">
          L'expert décide à la clôture de chaque barre {g.periode} et ne trade que pendant que Parnassa Trader est ouvert. Il ne gère que ses propres positions (numéro magique{actuel ? ` ${actuel.magic}` : ''}).
        </p>
        {actuel && (
          <p>
            Positions de l'expert : <b>{ouvertes.length}</b>
            {ouvertes.length > 0 && (
              <>
                {' '}
                — profit flottant <b className={flottant >= 0 ? 'positif' : 'negatif'}>{argent(flottant)} USD</b>
              </>
            )}
          </p>
        )}
      </div>
      <div className="boutons">
        {actuel && (
          <button
            onClick={() => {
              majGraphique(g.id, { expert: null });
              fermer();
            }}
          >
            Retirer
          </button>
        )}
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          onClick={() => {
            const magic = actuel?.type === type ? actuel.magic : 100000 + Math.floor(Math.random() * 900000);
            majGraphique(g.id, { expert: { type, p, magic } });
            fermer();
          }}
        >
          {actuel ? 'OK' : 'Attacher'}
        </button>
      </div>
    </Fenetre>
  );
}

// ---------- Rapport de trading ----------

interface Stats {
  depots: number;
  retraits: number;
  net: number;
  brutGain: number;
  brutPerte: number;
  facteur: number | null;
  esperance: number;
  sharpe: number | null;
  recouvrement: number | null;
  ddAbsolu: number;
  ddMax: number;
  ddMaxPct: number;
  trades: number;
  gagnants: number;
  longs: number;
  longsGagnants: number;
  courts: number;
  courtsGagnants: number;
  plusGrosGain: number;
  plusGrossePerte: number;
  gainMoyen: number;
  perteMoyenne: number;
  seriesGains: { n: number; montant: number };
  seriesPertes: { n: number; montant: number };
  parSymbole: { symbole: string; trades: number; net: number; gagnants: number }[];
  courbe: { t: number; v: number }[];
}

function calculerStats(c: Compte): Stats {
  const deals = [...c.transactions].sort((a, b) => a.heure - b.heure || a.ticket - b.ticket);
  const sorties = deals.filter((d) => d.entree === 'out');
  const resultat = (d: (typeof deals)[number]) => d.profit + d.swap + d.commission;
  const gains = sorties.filter((d) => resultat(d) > 0);
  const pertes = sorties.filter((d) => resultat(d) <= 0);
  const brutGain = gains.reduce((s, d) => s + resultat(d), 0);
  const brutPerte = pertes.reduce((s, d) => s + resultat(d), 0);
  const net = brutGain + brutPerte;
  const depots = deals.filter((d) => d.type === 'balance' && d.profit > 0).reduce((s, d) => s + d.profit, 0);
  const retraits = deals.filter((d) => d.type === 'balance' && d.profit < 0).reduce((s, d) => s + d.profit, 0);
  // Courbe de solde et drawdowns (sur le solde, les dépôts et retraits ne comptent pas comme pertes).
  const courbe: { t: number; v: number }[] = [];
  let sommet = 0;
  let ddMax = 0;
  let ddMaxPct = 0;
  let plusBas = Infinity;
  const premierDepot = deals.find((d) => d.type === 'balance')?.profit ?? 0;
  for (const d of deals) {
    if (d.type === 'balance') {
      sommet += d.profit;
      courbe.push({ t: d.heure, v: d.solde });
      continue;
    }
    if (d.entree !== 'out') continue;
    courbe.push({ t: d.heure, v: d.solde });
    sommet = Math.max(sommet, d.solde);
    const dd = sommet - d.solde;
    if (dd > ddMax) ddMax = dd;
    if (sommet > 0) ddMaxPct = Math.max(ddMaxPct, (dd / sommet) * 100);
    plusBas = Math.min(plusBas, d.solde);
  }
  const series = (signe: 1 | -1) => {
    let meilleure = { n: 0, montant: 0 };
    let cours = { n: 0, montant: 0 };
    for (const d of sorties) {
      const r = resultat(d);
      if ((signe > 0 && r > 0) || (signe < 0 && r <= 0)) {
        cours = { n: cours.n + 1, montant: cours.montant + r };
        if (cours.n > meilleure.n) meilleure = cours;
      } else cours = { n: 0, montant: 0 };
    }
    return meilleure;
  };
  const rendements = sorties.map(resultat);
  const moyenne = rendements.length ? net / rendements.length : 0;
  const ecart = rendements.length > 1 ? Math.sqrt(rendements.reduce((s, r) => s + (r - moyenne) ** 2, 0) / (rendements.length - 1)) : 0;
  const parSymboleMap = new Map<string, { trades: number; net: number; gagnants: number }>();
  for (const d of sorties) {
    const x = parSymboleMap.get(d.symbole) ?? { trades: 0, net: 0, gagnants: 0 };
    x.trades++;
    x.net += resultat(d);
    if (resultat(d) > 0) x.gagnants++;
    parSymboleMap.set(d.symbole, x);
  }
  // Le deal de sortie est en sens inverse de la position : une sortie « sell » ferme un achat (long).
  const longs = sorties.filter((d) => d.type === 'sell');
  const courts = sorties.filter((d) => d.type === 'buy');
  return {
    depots,
    retraits,
    net,
    brutGain,
    brutPerte,
    facteur: brutPerte < 0 ? brutGain / -brutPerte : null,
    esperance: moyenne,
    sharpe: ecart > 0 ? moyenne / ecart : null,
    recouvrement: ddMax > 0 ? net / ddMax : null,
    ddAbsolu: plusBas < premierDepot ? premierDepot - plusBas : 0,
    ddMax,
    ddMaxPct,
    trades: sorties.length,
    gagnants: gains.length,
    longs: longs.length,
    longsGagnants: longs.filter((d) => resultat(d) > 0).length,
    courts: courts.length,
    courtsGagnants: courts.filter((d) => resultat(d) > 0).length,
    plusGrosGain: gains.reduce((m, d) => Math.max(m, resultat(d)), 0),
    plusGrossePerte: pertes.reduce((m, d) => Math.min(m, resultat(d)), 0),
    gainMoyen: gains.length ? brutGain / gains.length : 0,
    perteMoyenne: pertes.length ? brutPerte / pertes.length : 0,
    seriesGains: series(1),
    seriesPertes: series(-1),
    parSymbole: [...parSymboleMap.entries()].map(([symbole, x]) => ({ symbole, ...x })).sort((a, b) => b.net - a.net),
    courbe,
  };
}

function CourbeSolde({ points }: { points: { t: number; v: number }[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { etat } = useTerminal();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const l = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = l * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const sombre = etat.theme === 'sombre';
    g.fillStyle = sombre ? '#151924' : '#fff';
    g.fillRect(0, 0, l, h);
    if (points.length < 2) {
      g.fillStyle = '#888';
      g.font = '12px Tahoma, sans-serif';
      g.fillText('La courbe apparaîtra après vos premières positions fermées.', 12, h / 2);
      return;
    }
    const min = Math.min(...points.map((p) => p.v));
    const max = Math.max(...points.map((p) => p.v));
    const marge = (max - min) * 0.1 || 1;
    const bas = min - marge;
    const haut = max + marge;
    const gauche = 70;
    const x = (i: number) => gauche + (i / (points.length - 1)) * (l - gauche - 10);
    const y = (v: number) => 8 + (1 - (v - bas) / (haut - bas)) * (h - 24);
    g.font = '10px Tahoma, sans-serif';
    for (let k = 0; k <= 4; k++) {
      const v = bas + ((haut - bas) * k) / 4;
      g.strokeStyle = sombre ? '#232836' : '#eee';
      g.beginPath();
      g.moveTo(gauche, y(v));
      g.lineTo(l - 10, y(v));
      g.stroke();
      g.fillStyle = sombre ? '#8a93a6' : '#666';
      g.fillText(argent(v), 4, y(v) + 3);
    }
    // Aire sous la courbe puis la courbe de solde.
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(x(i), y(p.v)) : g.lineTo(x(i), y(p.v))));
    g.lineTo(x(points.length - 1), h - 16);
    g.lineTo(x(0), h - 16);
    g.closePath();
    g.fillStyle = 'rgba(30, 111, 217, 0.12)';
    g.fill();
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(x(i), y(p.v)) : g.lineTo(x(i), y(p.v))));
    g.strokeStyle = '#1e6fd9';
    g.lineWidth = 1.6;
    g.stroke();
    g.fillStyle = sombre ? '#8a93a6' : '#666';
    g.fillText(dateMT(points[0].t, false), gauche, h - 3);
    const fin = dateMT(points[points.length - 1].t, false);
    g.fillText(fin, l - 10 - g.measureText(fin).width, h - 3);
  });
  return <canvas ref={ref} className="courbe-solde" />;
}

export function DialogueRapport() {
  const { compte, fermer, cotations } = useTerminal();
  const s = useMemo(() => calculerStats(compte), [compte]);
  const flottant = compte.positions.reduce((t, p) => t + profitPosition(p, cotations), 0);
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)} %` : '—');
  const L = ({ l, v, c }: { l: string; v: string; c?: string }) => (
    <tr>
      <td>{l}</td>
      <td className={`d ${c ?? ''}`}>{v}</td>
    </tr>
  );
  const signe = (v: number) => (v > 0 ? 'positif' : v < 0 ? 'negatif' : '');
  return (
    <Fenetre titre={`Rapport de trading — ${compte.login} : ${compte.nom}`} fermer={fermer} largeur={860} className="fenetre-rapport">
      <div className="rapport-tete">
        <div>
          <small>Solde</small>
          <b>{argent(compte.solde)} USD</b>
        </div>
        <div>
          <small>Bénéfice net</small>
          <b className={signe(s.net)}>{argent(s.net)}</b>
        </div>
        <div>
          <small>Profit flottant</small>
          <b className={signe(flottant)}>{argent(flottant)}</b>
        </div>
        <div>
          <small>Facteur de profit</small>
          <b>{s.facteur === null ? '—' : s.facteur.toFixed(2)}</b>
        </div>
        <div>
          <small>Drawdown max.</small>
          <b className="negatif">{s.ddMaxPct.toFixed(2)} %</b>
        </div>
        <div>
          <small>Trades</small>
          <b>{s.trades}</b>
        </div>
      </div>
      <CourbeSolde points={s.courbe} />
      <div className="rapport-grille">
        <table className="table specification">
          <tbody>
            <L l="Dépôts" v={argent(s.depots)} />
            <L l="Retraits" v={argent(s.retraits)} />
            <L l="Profit brut" v={argent(s.brutGain)} c="positif" />
            <L l="Perte brute" v={argent(s.brutPerte)} c="negatif" />
            <L l="Bénéfice net" v={argent(s.net)} c={signe(s.net)} />
            <L l="Gain espéré par trade" v={argent(s.esperance)} c={signe(s.esperance)} />
            <L l="Ratio de Sharpe" v={s.sharpe === null ? '—' : s.sharpe.toFixed(2)} />
            <L l="Facteur de récupération" v={s.recouvrement === null ? '—' : s.recouvrement.toFixed(2)} />
            <L l="Drawdown absolu du solde" v={argent(s.ddAbsolu)} />
            <L l="Drawdown maximal du solde" v={`${argent(s.ddMax)} (${s.ddMaxPct.toFixed(2)} %)`} />
          </tbody>
        </table>
        <table className="table specification">
          <tbody>
            <L l="Trades au total" v={String(s.trades)} />
            <L l="Positions longues (% gagnantes)" v={`${s.longs} (${pct(s.longsGagnants, s.longs)})`} />
            <L l="Positions courtes (% gagnantes)" v={`${s.courts} (${pct(s.courtsGagnants, s.courts)})`} />
            <L l="Trades gagnants (% du total)" v={`${s.gagnants} (${pct(s.gagnants, s.trades)})`} />
            <L l="Trades perdants (% du total)" v={`${s.trades - s.gagnants} (${pct(s.trades - s.gagnants, s.trades)})`} />
            <L l="Plus gros gain" v={argent(s.plusGrosGain)} c="positif" />
            <L l="Plus grosse perte" v={argent(s.plusGrossePerte)} c="negatif" />
            <L l="Gain moyen / perte moyenne" v={`${argent(s.gainMoyen)} / ${argent(s.perteMoyenne)}`} />
            <L l="Gains consécutifs max." v={`${s.seriesGains.n} (${argent(s.seriesGains.montant)})`} />
            <L l="Pertes consécutives max." v={`${s.seriesPertes.n} (${argent(s.seriesPertes.montant)})`} />
          </tbody>
        </table>
      </div>
      {s.parSymbole.length > 0 && (
        <table className="table boite-table rapport-symboles">
          <thead>
            <tr>
              <th>Symbole</th>
              <th className="d">Trades</th>
              <th className="d">% gagnants</th>
              <th className="d">Bénéfice net</th>
            </tr>
          </thead>
          <tbody>
            {s.parSymbole.map((x) => (
              <tr key={x.symbole}>
                <td>{x.symbole}</td>
                <td className="d">{x.trades}</td>
                <td className="d">{pct(x.gagnants, x.trades)}</td>
                <td className={`d gras ${signe(x.net)}`}>{argent(x.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    </Fenetre>
  );
}
