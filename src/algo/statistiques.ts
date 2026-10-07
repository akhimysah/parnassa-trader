import type { Transaction } from '../compte/moteur';

export interface Stats {
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

/** Statistiques façon rapport MT5, à partir des transactions (compte réel ou testeur de stratégie). */
export function calculerStats(transactions: Transaction[]): Stats {
  const deals = [...transactions].sort((a, b) => a.heure - b.heure || a.ticket - b.ticket);
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

