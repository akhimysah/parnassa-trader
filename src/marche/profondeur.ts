/**
 * Profondeur du marché (DOM) de tous les symboles. La crypto a le vrai carnet d'ordres Binance. Pour le forex, les
 * métaux, les indices, l'énergie et les actions il n'existe pas de carnet public : comme les courtiers CFD sous MT5,
 * le terminal montre la liquidité indicative du courtier, en paliers de volume croissants autour du Bid/Ask réel.
 */
import { useEffect, useState } from 'react';
import { abonnerProfondeur, type Carnet } from './binance';
import type { Cotation } from './cotations';
import { point, spreadPoints, type SymboleMT, type TypeCompte } from './symboles';

const PALIERS = [1, 2, 3, 5, 5, 8, 10, 15, 20, 30, 40, 50];

/** Petit bruit reproductible (même prix, même instant → même volume), pour un carnet qui vit sans sauter. */
function bruit(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Liquidité indicative du courtier : `niveaux` paliers de chaque côté, à partir du Bid et de l'Ask du compte. */
export function profondeurIndicative(s: SymboleMT, q: Cotation, type: TypeCompte, niveaux = 12, instant = Date.now()): Carnet {
  const pas = Math.max(1, Math.round(spreadPoints(s, type) / 4)) * point(s);
  const echelle = s.volumeMin * 100;
  const tranche = Math.floor(instant / 5000);
  const volume = (prix: number, k: number) => {
    const v = PALIERS[Math.min(k, PALIERS.length - 1)] * echelle * (0.7 + 0.6 * bruit(Math.round(prix / pas) + tranche));
    return Math.min(s.volumeMax, Math.max(s.volumeMin, Math.round(v / s.pasVolume) * s.pasVolume));
  };
  const arrondi = (v: number) => Number(v.toFixed(s.chiffres));
  return {
    bids: Array.from({ length: niveaux }, (_, k) => {
      const p = arrondi(q.bid - k * pas);
      return [p, volume(p, k)] as [number, number];
    }),
    asks: Array.from({ length: niveaux }, (_, k) => {
      const p = arrondi(q.ask + k * pas);
      return [p, volume(p, k)] as [number, number];
    }),
  };
}

export interface Profondeur {
  carnet: Carnet | null;
  /** Vrai carnet de marché (Binance) ou liquidité indicative du courtier. */
  reel: boolean;
  /** Unité des volumes affichés. */
  unite: string;
  source: string;
}

/** Profondeur du symbole, à jour : carnet Binance en direct, sinon liquidité indicative recalculée à chaque cotation. */
export function useProfondeur(s: SymboleMT, q: Cotation | undefined, type: TypeCompte): Profondeur {
  const [carnet, setCarnet] = useState<Carnet | null>(null);
  const paire = s.direct.binance;
  useEffect(() => {
    setCarnet(null);
    return paire ? abonnerProfondeur(paire, setCarnet) : undefined;
  }, [paire]);
  if (paire) return { carnet, reel: true, unite: s.base, source: `carnet Binance ${paire}` };
  return { carnet: q ? profondeurIndicative(s, q, type) : null, reel: false, unite: 'lots', source: 'liquidité indicative du courtier' };
}
