import type { Bougie } from '../marche/bougies';

/**
 * Bougies Heikin Ashi : clôture = moyenne OHLC, ouverture = milieu de la bougie Heikin Ashi précédente.
 * Elles lissent le bruit et font ressortir les tendances ; les prix réels restent ceux des bougies d'origine.
 */
export function heikin(b: Bougie[]): Bougie[] {
  const r: Bougie[] = [];
  for (let i = 0; i < b.length; i++) r.push(heikinSuivante(r[i - 1], b[i]));
  return r;
}

export function heikinSuivante(prec: Bougie | undefined, x: Bougie): Bougie {
  const close = (x.open + x.high + x.low + x.close) / 4;
  const open = prec ? (prec.open + prec.close) / 2 : (x.open + x.close) / 2;
  return { time: x.time, open, close, high: Math.max(x.high, open, close), low: Math.min(x.low, open, close), volume: x.volume };
}
