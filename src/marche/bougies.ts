import { klines, type Bougie } from './binance';
import type { SymboleMT } from './symboles';

export type { Bougie };

export type Periode = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

export const PERIODES: { id: Periode; libelle: string; secondes: number }[] = [
  { id: 'M1', libelle: '1 minute', secondes: 60 },
  { id: 'M5', libelle: '5 minutes', secondes: 300 },
  { id: 'M15', libelle: '15 minutes', secondes: 900 },
  { id: 'M30', libelle: '30 minutes', secondes: 1800 },
  { id: 'H1', libelle: '1 heure', secondes: 3600 },
  { id: 'H4', libelle: '4 heures', secondes: 14400 },
  { id: 'D1', libelle: 'Quotidien', secondes: 86400 },
  { id: 'W1', libelle: 'Hebdomadaire', secondes: 604800 },
  { id: 'MN', libelle: 'Mensuel', secondes: 2592000 },
];

const BINANCE: Record<Periode, string> = { M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h', D1: '1d', W1: '1w', MN: '1M' };
/** Intervalle et profondeur demandés à Yahoo (H4 est reconstruit à partir de H1). */
const YAHOO: Record<Periode, { i: string; r: string }> = {
  M1: { i: '1m', r: '5d' },
  M5: { i: '5m', r: '1mo' },
  M15: { i: '15m', r: '1mo' },
  M30: { i: '30m', r: '1mo' },
  H1: { i: '60m', r: '6mo' },
  H4: { i: '60m', r: '2y' },
  D1: { i: '1d', r: '5y' },
  W1: { i: '1wk', r: '10y' },
  MN: { i: '1mo', r: 'max' },
};

/** Relais Cloudflare de Parnassa (l'API de bougies de Yahoo n'a pas d'en-têtes CORS). */
export const RELAIS = 'https://parnassa-actualites.neobank.workers.dev';

export function secondesPeriode(p: Periode): number {
  return PERIODES.find((x) => x.id === p)!.secondes;
}

/** Début de la bougie contenant l'instant `t` (secondes UTC). Semaines alignées sur le lundi, mois calendaires. */
export function debutBougie(t: number, p: Periode): number {
  if (p === 'MN') {
    const d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  if (p === 'W1') {
    // 1er janvier 1970 = jeudi : décalage de 3 jours pour aligner sur le lundi.
    const s = 604800;
    return Math.floor((t - 345600) / s) * s + 345600;
  }
  const s = secondesPeriode(p);
  return Math.floor(t / s) * s;
}

function regrouper(bougies: Bougie[], p: Periode): Bougie[] {
  const sortie: Bougie[] = [];
  for (const b of bougies) {
    const t = debutBougie(b.time, p);
    const der = sortie[sortie.length - 1];
    if (der && der.time === t) {
      der.high = Math.max(der.high, b.high);
      der.low = Math.min(der.low, b.low);
      der.close = b.close;
      der.volume += b.volume;
    } else sortie.push({ ...b, time: t });
  }
  return sortie;
}

async function bougiesYahoo(sym: string, p: Periode): Promise<Bougie[]> {
  const { i, r } = YAHOO[p];
  const rep = await fetch(`${RELAIS}/bougies?s=${encodeURIComponent(sym)}&i=${i}&r=${r}`, { signal: AbortSignal.timeout(15000) });
  if (!rep.ok) throw new Error(`Relais ${rep.status}`);
  const d = (await rep.json()) as { bougies?: number[][] };
  // Yahoo horodate les bougies quotidiennes du forex à 22 h ou 23 h UTC la veille : on les décale de 2 h
  // avant de les aligner sur nos débuts de période.
  const decalage = p === 'D1' || p === 'W1' || p === 'MN' ? 7200 : 0;
  const brutes = (d.bougies ?? []).map(([time, open, high, low, close, volume]) => ({ time: time + decalage, open, high, low, close, volume }));
  return regrouper(brutes, p);
}

/**
 * Historique du symbole sur la période demandée. Si `recaler` est vrai (contrat à terme pour un spot),
 * les bougies sont multipliées pour que la dernière clôture coïncide avec la cotation actuelle `reference`.
 */
export async function chargerBougies(s: SymboleMT, p: Periode, reference?: number): Promise<Bougie[]> {
  let bougies: Bougie[];
  if (s.histo.binance) bougies = regrouper(await klines(s.histo.binance, BINANCE[p], 1000), p);
  else if (s.histo.yahoo) bougies = await bougiesYahoo(s.histo.yahoo, p);
  else return [];
  const arrondi = (v: number) => Number(v.toFixed(s.chiffres));
  const der = bougies[bougies.length - 1];
  const facteur = s.histo.recaler && reference && der ? reference / der.close : 1;
  return bougies.map((b) => ({ ...b, open: arrondi(b.open * facteur), high: arrondi(b.high * facteur), low: arrondi(b.low * facteur), close: arrondi(b.close * facteur) }));
}
