/**
 * Testeur de stratégie : rejoue un Expert Advisor sur l'historique d'un symbole, comme le Strategy Tester de MT5.
 * Les bougies sont des prix Bid ; l'Ask vaut Bid + spread. L'expert décide à l'ouverture de chaque barre sur les
 * barres déjà clôturées, puis les stop-loss / take-profit sont vérifiés à l'intérieur de la barre.
 */
import type { Bougie } from '../marche/bougies';
import { commissionParCote, point, rolloversEntre, swapPoints, type SymboleMT, type TypeCompte } from '../marche/symboles';
import type { Sens, Transaction } from '../compte/moteur';
import { NIVEAU_STOP_OUT } from '../compte/moteur';
import { decider, type Expert } from './experts';
import { calculerStats, type Stats } from './statistiques';

export type Modelisation = 'ouverture' | 'ohlc';

export interface ParametresTest {
  s: SymboleMT;
  expert: Expert;
  bougies: Bougie[];
  depot: number;
  levier: number;
  /** Spread en points. */
  spread: number;
  modelisation: Modelisation;
  /** Valeur en USD d'une unité de la devise de profit (taux actuel, supposé constant sur la période). */
  conversion: number;
  /** Compte Raw : commission par lot à l'ouverture et à la fermeture. */
  typeCompte?: TypeCompte;
  /** Swaps débités / crédités à chaque rollover (sauf compte sans swap). */
  swaps?: boolean;
  /** Indice de la première barre tradée : les barres d'avant ne servent qu'à amorcer les indicateurs (avant-test). */
  debut?: number;
}

export interface Marqueur {
  time: number;
  sens: Sens;
  entree: boolean;
  prix: number;
  texte: string;
}

export interface ResultatTest {
  transactions: Transaction[];
  fonds: { t: number; v: number }[];
  journal: { t: number; message: string }[];
  marqueurs: Marqueur[];
  stats: Stats;
  /** Barres simulées et durée du calcul. */
  barres: number;
  dureeMs: number;
}

interface PositionTest {
  ticket: number;
  type: Sens;
  volume: number;
  prix: number;
  sl: number;
  tp: number;
  heure: number;
  swap: number;
  dernierSwap: number;
  /** Stop suiveur et seuil de break-even, en points (0 = aucun). */
  suiveur: number;
  equilibre: number;
  /** Extrêmes du résultat latent (points). */
  mfe: number;
  mae: number;
}

/** Fenêtre de barres transmise à l'expert : assez pour amorcer ses indicateurs, sans recalcul quadratique. */
const FENETRE = 400;

export function lancerTest(pt: ParametresTest): ResultatTest {
  const debut = performance.now();
  const { s, expert, bougies: b, depot, levier, modelisation, conversion } = pt;
  const pas = point(s);
  const ecart = pt.spread * pas;
  const levierEff = Math.max(1, Math.min(levier, s.levierMax));
  const arrondi = (v: number) => Number(v.toFixed(s.chiffres));
  const argent = (v: number) => Number(v.toFixed(2));
  let solde = depot;
  let ticket = 1;
  const positions: PositionTest[] = [];
  const transactions: Transaction[] = [];
  const fonds: { t: number; v: number }[] = [];
  const journal: { t: number; message: string }[] = [];
  const marqueurs: Marqueur[] = [];
  const premiere = Math.max(1, pt.debut ?? 1);
  const t0 = (b[premiere - 1]?.time ?? 0) * 1000;
  transactions.push({ ticket: ticket++, ordre: 0, position: 0, heure: t0, symbole: '', type: 'balance', entree: '', volume: 0, prix: 0, commission: 0, swap: 0, profit: depot, solde: depot, commentaire: 'Dépôt initial' });

  const valeur = (p: PositionTest, bid: number) => (p.type === 'buy' ? bid - p.prix : p.prix - (bid + ecart)) * p.volume * s.contrat * conversion + p.swap;
  const marge = (p: PositionTest) => (p.volume * s.contrat * p.prix * conversion) / levierEff;
  const commission = (volume: number, prix: number) => -argent(commissionParCote(s, pt.typeCompte ?? 'standard', volume, volume * s.contrat * prix * conversion)) || 0;
  const fermer = (p: PositionTest, prix: number, heure: number, raison: string) => {
    const profit = argent((p.type === 'buy' ? prix - p.prix : p.prix - prix) * p.volume * s.contrat * conversion);
    const frais = commission(p.volume, prix);
    const swap = argent(p.swap);
    solde = argent(solde + profit + frais + swap);
    transactions.push({
      ticket: ticket++,
      ordre: 0,
      position: p.ticket,
      heure,
      symbole: s.nom,
      type: p.type === 'buy' ? 'sell' : 'buy',
      entree: 'out',
      volume: p.volume,
      prix,
      commission: frais,
      swap,
      profit,
      solde,
      commentaire: raison,
      prixOuverture: p.prix,
      heureOuverture: p.heure,
      sl: p.sl,
      tp: p.tp,
      mfe: Math.round(Math.max(p.mfe, (p.type === 'buy' ? prix - p.prix : p.prix - prix) / pas) * 10) / 10,
      mae: Math.round(Math.min(p.mae, (p.type === 'buy' ? prix - p.prix : p.prix - prix) / pas) * 10) / 10,
    });
    marqueurs.push({ time: Math.floor(heure / 1000), sens: p.type === 'buy' ? 'sell' : 'buy', entree: false, prix, texte: raison });
    positions.splice(positions.indexOf(p), 1);
  };
  const volume = Number(Math.min(s.volumeMax, Math.max(s.volumeMin, Math.round(expert.p.volume / s.pasVolume) * s.pasVolume)).toFixed(2));

  for (let i = premiere; i < b.length; i++) {
    const barre = b[i];
    const heure = barre.time * 1000;
    // 1. Décision de l'expert à l'ouverture de la barre, sur les barres clôturées.
    const d = decider(expert, b.slice(Math.max(0, i - FENETRE), i), positions[0]?.type ?? null);
    for (const p of positions.filter((x) => d.fermer.includes(x.type))) fermer(p, p.type === 'buy' ? barre.open : arrondi(barre.open + ecart), heure, 'signal');
    if (d.ouvrir && !positions.some((x) => x.type === d.ouvrir)) {
      const prix = d.ouvrir === 'buy' ? arrondi(barre.open + ecart) : barre.open;
      const sens = d.ouvrir === 'buy' ? 1 : -1;
      const p: PositionTest = {
        ticket: ticket++,
        type: d.ouvrir,
        volume,
        prix,
        sl: expert.p.sl ? arrondi(prix - sens * expert.p.sl * pas) : 0,
        tp: expert.p.tp ? arrondi(prix + sens * expert.p.tp * pas) : 0,
        heure,
        swap: 0,
        dernierSwap: heure,
        suiveur: expert.p.suiveur ?? 0,
        equilibre: expert.p.equilibre ?? 0,
        mfe: 0,
        mae: 0,
      };
      const fondsPropres = solde + positions.reduce((t, x) => t + valeur(x, barre.open), 0);
      const utilisee = positions.reduce((t, x) => t + marge(x), 0);
      if (marge(p) > fondsPropres - utilisee) {
        journal.push({ t: heure, message: `ordre ${d.ouvrir} ${volume.toFixed(2)} refusé : pas assez d'argent` });
      } else {
        positions.push(p);
        const frais = commission(volume, prix);
        solde = argent(solde + frais);
        transactions.push({ ticket: ticket++, ordre: p.ticket, position: p.ticket, heure, symbole: s.nom, type: p.type, entree: 'in', volume, prix, commission: frais, swap: 0, profit: 0, solde, commentaire: d.raison });
        marqueurs.push({ time: barre.time, sens: p.type, entree: true, prix, texte: d.raison });
      }
    }
    // 2. Stop-loss / take-profit dans la barre (chemin O-B-H-C pour une barre haussière, O-H-B-C sinon).
    const chemin = modelisation === 'ohlc' ? (barre.close >= barre.open ? [barre.open, barre.low, barre.high, barre.close] : [barre.open, barre.high, barre.low, barre.close]) : [barre.open];
    for (let k = 0; k < chemin.length; k++) {
      const bid = chemin[k];
      const ask = bid + ecart;
      for (const p of [...positions]) {
        // Break-even puis stop suiveur, au prix de fermeture du chemin (Bid pour un achat, Ask pour une vente).
        const fermeture = p.type === 'buy' ? bid : ask;
        const gain = p.type === 'buy' ? fermeture - p.prix : p.prix - fermeture;
        p.mfe = Math.max(p.mfe, gain / pas);
        p.mae = Math.min(p.mae, gain / pas);
        if (p.equilibre > 0 && gain >= p.equilibre * pas) {
          if (p.type === 'buy' ? p.prix > p.sl : p.sl === 0 || p.prix < p.sl) p.sl = p.prix;
          p.equilibre = 0;
        }
        if (p.suiveur > 0 && gain > p.suiveur * pas) {
          const cible = arrondi(p.type === 'buy' ? fermeture - p.suiveur * pas : fermeture + p.suiveur * pas);
          if (p.type === 'buy' ? cible > p.sl : p.sl === 0 || cible < p.sl) p.sl = cible;
        }
        // À l'ouverture (k = 0), un écart de cotation exécute le stop au prix d'ouverture ; ensuite au niveau exact.
        if (p.type === 'buy') {
          if (p.sl && bid <= p.sl) fermer(p, k === 0 ? bid : p.sl, heure, 'sl');
          else if (p.tp && bid >= p.tp) fermer(p, k === 0 ? bid : p.tp, heure, 'tp');
        } else {
          if (p.sl && ask >= p.sl) fermer(p, k === 0 ? arrondi(ask) : p.sl, heure, 'sl');
          else if (p.tp && ask <= p.tp) fermer(p, k === 0 ? arrondi(ask) : p.tp, heure, 'tp');
        }
      }
    }
    // Swaps des rollovers passés pendant la barre (au prix de clôture).
    if (pt.swaps !== false) {
      for (const p of positions) {
        const nuits = rolloversEntre(s, p.dernierSwap, heure + 1);
        if (!nuits.length) continue;
        const points = swapPoints(s, barre.close)[p.type === 'buy' ? 'long' : 'short'];
        p.swap += nuits.reduce((t, n) => t + n.fois, 0) * points * pas * s.contrat * p.volume * conversion;
        p.dernierSwap = nuits[nuits.length - 1].t;
      }
    }
    // 3. Fonds propres à la clôture et stop-out.
    let fp = solde + positions.reduce((t, x) => t + valeur(x, barre.close), 0);
    let utilisee = positions.reduce((t, x) => t + marge(x), 0);
    while (positions.length && utilisee > 0 && (fp / utilisee) * 100 < NIVEAU_STOP_OUT) {
      const pire = positions.reduce((a, x) => (valeur(x, barre.close) < valeur(a, barre.close) ? x : a));
      journal.push({ t: heure, message: `stop-out : niveau de marge ${((fp / utilisee) * 100).toFixed(2)} %` });
      fermer(pire, pire.type === 'buy' ? barre.close : arrondi(barre.close + ecart), heure, 'so');
      fp = solde + positions.reduce((t, x) => t + valeur(x, barre.close), 0);
      utilisee = positions.reduce((t, x) => t + marge(x), 0);
    }
    fonds.push({ t: heure, v: argent(fp) });
  }
  const der = b[b.length - 1];
  for (const p of [...positions]) fermer(p, p.type === 'buy' ? der.close : arrondi(der.close + ecart), der.time * 1000, 'fin du test');
  return { transactions, fonds, journal, marqueurs, stats: calculerStats(transactions), barres: b.length - premiere + 1, dureeMs: performance.now() - debut };
}

// ---------- Optimisation ----------

export interface PlageOptimisation {
  debut: number;
  pas: number;
  fin: number;
}

export interface Passe {
  numero: number;
  p: Record<string, number>;
  profit: number;
  trades: number;
  facteur: number | null;
  esperance: number;
  ddPct: number;
  recouvrement: number | null;
  sharpe: number | null;
  /** Résultat de la même passe sur la période d'avant-test (si demandée). */
  avant?: { profit: number; facteur: number | null; ddPct: number; trades: number };
}

/** Toutes les combinaisons des paramètres optimisés (au plus `max`). */
export function combinaisons(base: Record<string, number>, plages: Record<string, PlageOptimisation>, max = 2000): Record<string, number>[] {
  let liste: Record<string, number>[] = [{ ...base }];
  for (const [cle, pl] of Object.entries(plages)) {
    if (!(pl.pas > 0) || pl.fin < pl.debut) continue;
    const valeurs: number[] = [];
    for (let v = pl.debut; v <= pl.fin + 1e-9 && valeurs.length < 500; v += pl.pas) valeurs.push(Number(v.toFixed(6)));
    liste = liste.flatMap((c) => valeurs.map((v) => ({ ...c, [cle]: v })));
    if (liste.length > max) return liste.slice(0, max);
  }
  return liste;
}

/** Lance toutes les passes en rendant la main au navigateur entre deux lots (barre de progression, annulation). */
export async function optimiser(
  base: Omit<ParametresTest, 'expert'> & { expert: Expert },
  jeux: Record<string, number>[],
  progression: (fait: number, passes: Passe[]) => void,
  annule: () => boolean,
  avant?: Omit<ParametresTest, 'expert'> & { expert: Expert },
): Promise<Passe[]> {
  const passes: Passe[] = [];
  for (let i = 0; i < jeux.length; i++) {
    if (annule()) break;
    const r = lancerTest({ ...base, expert: { ...base.expert, p: jeux[i] } });
    passes.push({
      numero: i + 1,
      p: jeux[i],
      profit: r.stats.net,
      trades: r.stats.trades,
      facteur: r.stats.facteur,
      esperance: r.stats.esperance,
      ddPct: r.stats.ddMaxPct,
      recouvrement: r.stats.recouvrement,
      sharpe: r.stats.sharpe,
      ...(avant
        ? (() => {
            const f = lancerTest({ ...avant, expert: { ...avant.expert, p: jeux[i] } }).stats;
            return { avant: { profit: f.net, facteur: f.facteur, ddPct: f.ddMaxPct, trades: f.trades } };
          })()
        : {}),
    });
    if (i % 4 === 3 || i === jeux.length - 1) {
      progression(i + 1, passes);
      await new Promise((ok) => setTimeout(ok, 0));
    }
  }
  return passes;
}

// ---------- Optimisation génétique (comme l'« algorithme génétique rapide » de MT5) ----------

/** Nombre total de combinaisons des plages (sans les énumérer). */
export function nombreCombinaisons(plages: Record<string, PlageOptimisation>): number {
  return Object.values(plages).reduce((n, pl) => n * (pl.pas > 0 && pl.fin >= pl.debut ? Math.floor((pl.fin - pl.debut) / pl.pas + 1e-9) + 1 : 1), 1);
}

/**
 * Population de jeux d'entrées tirés dans les plages, gardant les meilleurs (critère `note`), croisant et mutant les
 * autres génération après génération ; chaque jeu n'est testé qu'une fois. S'arrête après `generations` ou quand
 * le meilleur ne progresse plus depuis 5 générations.
 */
export async function optimiserGenetique(
  base: Omit<ParametresTest, 'expert'> & { expert: Expert },
  plages: Record<string, PlageOptimisation>,
  note: (p: Passe) => number,
  progression: (fait: number, total: number, passes: Passe[]) => void,
  annule: () => boolean,
  avant?: Omit<ParametresTest, 'expert'> & { expert: Expert },
  taille = 32,
  generations = 30,
): Promise<Passe[]> {
  const cles = Object.keys(plages).filter((k) => plages[k].pas > 0 && plages[k].fin >= plages[k].debut);
  const valeurs = (k: string) => Math.floor((plages[k].fin - plages[k].debut) / plages[k].pas + 1e-9) + 1;
  const val = (k: string, i: number) => Number((plages[k].debut + i * plages[k].pas).toFixed(6));
  const cle = (g: number[]) => g.join(',');
  const vu = new Map<string, Passe>();
  const passes: Passe[] = [];
  const tester = (g: number[]): Passe => {
    const deja = vu.get(cle(g));
    if (deja) return deja;
    const p = { ...base.expert.p, ...Object.fromEntries(cles.map((k, i) => [k, val(k, g[i])])) };
    const r = lancerTest({ ...base, expert: { ...base.expert, p } });
    const passe: Passe = {
      numero: passes.length + 1,
      p,
      profit: r.stats.net,
      trades: r.stats.trades,
      facteur: r.stats.facteur,
      esperance: r.stats.esperance,
      ddPct: r.stats.ddMaxPct,
      recouvrement: r.stats.recouvrement,
      sharpe: r.stats.sharpe,
      ...(avant
        ? (() => {
            const f = lancerTest({ ...avant, expert: { ...avant.expert, p } }).stats;
            return { avant: { profit: f.net, facteur: f.facteur, ddPct: f.ddMaxPct, trades: f.trades } };
          })()
        : {}),
    };
    vu.set(cle(g), passe);
    passes.push(passe);
    return passe;
  };
  const hasard = () => cles.map((k) => Math.floor(Math.random() * valeurs(k)));
  let population = Array.from({ length: taille }, hasard);
  let meilleure = -Infinity;
  let stagnation = 0;
  const total = taille * generations;
  for (let gen = 0; gen < generations && !annule(); gen++) {
    const notes = population.map((g) => ({ g, n: note(tester(g)) }));
    progression(passes.length, total, passes);
    await new Promise((ok) => setTimeout(ok, 0));
    notes.sort((a, b) => b.n - a.n);
    if (notes[0].n > meilleure + 1e-9) {
      meilleure = notes[0].n;
      stagnation = 0;
    } else if (++stagnation >= 5) break;
    // Élitisme : les 4 meilleurs passent tels quels ; le reste naît de tournois, croisement et mutation.
    const tournoi = () => {
      const a = notes[Math.floor(Math.random() * notes.length)];
      const b = notes[Math.floor(Math.random() * notes.length)];
      return (a.n >= b.n ? a : b).g;
    };
    const suivante = notes.slice(0, 4).map((x) => x.g);
    while (suivante.length < taille) {
      const pere = tournoi();
      const mere = tournoi();
      const enfant = pere.map((v, i) => (Math.random() < 0.5 ? v : mere[i]));
      for (let i = 0; i < enfant.length; i++) {
        if (Math.random() < 0.15) {
          const n = valeurs(cles[i]);
          // Mutation surtout locale (± quelques pas), parfois un saut n'importe où dans la plage.
          enfant[i] = Math.random() < 0.7 ? Math.min(n - 1, Math.max(0, enfant[i] + Math.round((Math.random() - 0.5) * Math.max(2, n / 5)))) : Math.floor(Math.random() * n);
        }
      }
      suivante.push(enfant);
    }
    population = suivante;
  }
  progression(passes.length, passes.length, passes);
  return passes;
}
