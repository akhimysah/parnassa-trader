/**
 * Testeur de stratégie : rejoue un Expert Advisor sur l'historique d'un symbole, comme le Strategy Tester de MT5.
 * Les bougies sont des prix Bid ; l'Ask vaut Bid + spread. L'expert décide à l'ouverture de chaque barre sur les
 * barres déjà clôturées, puis les stop-loss / take-profit sont vérifiés à l'intérieur de la barre.
 */
import type { Bougie } from '../marche/bougies';
import { point, type SymboleMT } from '../marche/symboles';
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
  const t0 = (b[0]?.time ?? 0) * 1000;
  transactions.push({ ticket: ticket++, ordre: 0, position: 0, heure: t0, symbole: '', type: 'balance', entree: '', volume: 0, prix: 0, commission: 0, swap: 0, profit: depot, solde: depot, commentaire: 'Dépôt initial' });

  const valeur = (p: PositionTest, bid: number) => (p.type === 'buy' ? bid - p.prix : p.prix - (bid + ecart)) * p.volume * s.contrat * conversion;
  const marge = (p: PositionTest) => (p.volume * s.contrat * p.prix * conversion) / levierEff;
  const fermer = (p: PositionTest, prix: number, heure: number, raison: string) => {
    const profit = argent((p.type === 'buy' ? prix - p.prix : p.prix - prix) * p.volume * s.contrat * conversion);
    solde = argent(solde + profit);
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
      commission: 0,
      swap: 0,
      profit,
      solde,
      commentaire: raison,
      prixOuverture: p.prix,
      heureOuverture: p.heure,
      sl: p.sl,
      tp: p.tp,
    });
    marqueurs.push({ time: Math.floor(heure / 1000), sens: p.type === 'buy' ? 'sell' : 'buy', entree: false, prix, texte: raison });
    positions.splice(positions.indexOf(p), 1);
  };
  const volume = Number(Math.min(s.volumeMax, Math.max(s.volumeMin, Math.round(expert.p.volume / s.pasVolume) * s.pasVolume)).toFixed(2));

  for (let i = 1; i < b.length; i++) {
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
      };
      const fondsPropres = solde + positions.reduce((t, x) => t + valeur(x, barre.open), 0);
      const utilisee = positions.reduce((t, x) => t + marge(x), 0);
      if (marge(p) > fondsPropres - utilisee) {
        journal.push({ t: heure, message: `ordre ${d.ouvrir} ${volume.toFixed(2)} refusé : pas assez d'argent` });
      } else {
        positions.push(p);
        transactions.push({ ticket: ticket++, ordre: p.ticket, position: p.ticket, heure, symbole: s.nom, type: p.type, entree: 'in', volume, prix, commission: 0, swap: 0, profit: 0, solde, commentaire: d.raison });
        marqueurs.push({ time: barre.time, sens: p.type, entree: true, prix, texte: d.raison });
      }
    }
    // 2. Stop-loss / take-profit dans la barre (chemin O-B-H-C pour une barre haussière, O-H-B-C sinon).
    const chemin = modelisation === 'ohlc' ? (barre.close >= barre.open ? [barre.open, barre.low, barre.high, barre.close] : [barre.open, barre.high, barre.low, barre.close]) : [barre.open];
    for (let k = 0; k < chemin.length; k++) {
      const bid = chemin[k];
      const ask = bid + ecart;
      for (const p of [...positions]) {
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
  return { transactions, fonds, journal, marqueurs, stats: calculerStats(transactions), barres: b.length, dureeMs: performance.now() - debut };
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
    });
    if (i % 4 === 3 || i === jeux.length - 1) {
      progression(i + 1, passes);
      await new Promise((ok) => setTimeout(ok, 0));
    }
  }
  return passes;
}
