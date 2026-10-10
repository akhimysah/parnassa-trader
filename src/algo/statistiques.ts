import type { Transaction } from '../compte/moteur';
import { point, symbole } from '../marche/symboles';

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
  /** Résultat des trades selon l'heure (0-23, heure locale) et le jour (0 = lundi) de leur ouverture. */
  parHeure: { trades: number; net: number }[];
  parJour: { trades: number; net: number }[];
  /** Durée moyenne de détention (ms) des trades gagnants et perdants. */
  dureeGains: number;
  dureePertes: number;
  /** MFE et MAE moyens (points) et efficacité des sorties : part du meilleur gain latent réellement encaissée. */
  mfeMoyen: number | null;
  maeMoyen: number | null;
  efficacite: number | null;
}

/** Statistiques façon rapport MT5, à partir des transactions (compte réel ou testeur de stratégie). */
export function calculerStats(transactions: Transaction[]): Stats {
  const deals = [...transactions].sort((a, b) => a.heure - b.heure || a.ticket - b.ticket);
  const sorties = deals.filter((d) => d.entree === 'out');
  // Commission d'entrée (compte Raw) rattachée à la première sortie de la position : chaque trade porte tous ses coûts.
  const entrees = new Map<number, number>();
  for (const d of deals) if (d.entree === 'in' && d.commission) entrees.set(d.position, (entrees.get(d.position) ?? 0) + d.commission);
  const supplement = new Map<number, number>();
  for (const d of deals) {
    if (d.entree !== 'out' || !entrees.has(d.position)) continue;
    supplement.set(d.ticket, entrees.get(d.position)!);
    entrees.delete(d.position);
  }
  const resultat = (d: (typeof deals)[number]) => d.profit + d.swap + d.commission + (supplement.get(d.ticket) ?? 0);
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
  // Répartition par heure et jour d'ouverture, et durées de détention (comme le rapport de MT5).
  const parHeure = Array.from({ length: 24 }, () => ({ trades: 0, net: 0 }));
  const parJour = Array.from({ length: 7 }, () => ({ trades: 0, net: 0 }));
  const durees = { gains: [] as number[], pertes: [] as number[] };
  for (const d of sorties) {
    const ouverture = d.heureOuverture ?? d.heure;
    const date = new Date(ouverture);
    const r = resultat(d);
    parHeure[date.getHours()].trades++;
    parHeure[date.getHours()].net += r;
    const jour = (date.getDay() + 6) % 7;
    parJour[jour].trades++;
    parJour[jour].net += r;
    if (d.heureOuverture) (r > 0 ? durees.gains : durees.pertes).push(d.heure - d.heureOuverture);
  }
  const moyenneDe = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const avecExcursion = sorties.filter((d) => d.mfe !== undefined && d.mae !== undefined && d.prixOuverture);
  let encaisse = 0;
  let potentiel = 0;
  for (const d of avecExcursion) {
    const s = symbole(d.symbole);
    if (!s || !d.mfe || d.mfe <= 0) continue;
    // Le deal de sortie est en sens inverse : une sortie « sell » ferme un achat.
    encaisse += ((d.type === 'sell' ? d.prix - d.prixOuverture! : d.prixOuverture! - d.prix) / point(s));
    potentiel += d.mfe;
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
    parHeure,
    parJour,
    dureeGains: moyenneDe(durees.gains),
    dureePertes: moyenneDe(durees.pertes),
    mfeMoyen: avecExcursion.length ? moyenneDe(avecExcursion.map((d) => d.mfe!)) : null,
    maeMoyen: avecExcursion.length ? moyenneDe(avecExcursion.map((d) => d.mae!)) : null,
    efficacite: potentiel > 0 ? encaisse / potentiel : null,
  };
}

