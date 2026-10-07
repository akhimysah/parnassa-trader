import type { Schema } from '../etat';

export interface Couleurs {
  fond: string;
  texte: string;
  grille: string;
  hausse: string;
  baisse: string;
  corpsHausse: string;
  corpsBaisse: string;
  ligne: string;
  bid: string;
  ask: string;
  stops: string;
  achat: string;
  vente: string;
}

/** Les trois jeux de couleurs livrés avec MetaTrader 5 (Propriétés du graphique → Couleurs). */
export const SCHEMAS: Record<Schema, { nom: string; c: Couleurs }> = {
  'vert-noir': {
    nom: 'Vert sur noir',
    c: { fond: '#000000', texte: '#ffffff', grille: '#2f4f4f', hausse: '#00ff00', baisse: '#00ff00', corpsHausse: '#000000', corpsBaisse: '#ffffff', ligne: '#00ff00', bid: '#778899', ask: '#ff0000', stops: '#ff0000', achat: '#1e90ff', vente: '#ff3b30' },
  },
  'noir-blanc': {
    nom: 'Noir sur blanc',
    c: { fond: '#ffffff', texte: '#000000', grille: '#c0c0c0', hausse: '#000000', baisse: '#000000', corpsHausse: '#ffffff', corpsBaisse: '#000000', ligne: '#000000', bid: '#c0c0c0', ask: '#ff0000', stops: '#ff0000', achat: '#1e90ff', vente: '#ff3b30' },
  },
  couleurs: {
    nom: 'Couleurs',
    c: { fond: '#ffffff', texte: '#323232', grille: '#e8e8e8', hausse: '#26a69a', baisse: '#ef5350', corpsHausse: '#26a69a', corpsBaisse: '#ef5350', ligne: '#1e90ff', bid: '#778899', ask: '#ff3b30', stops: '#ff3b30', achat: '#1e90ff', vente: '#ef5350' },
  },
};

/** En thème sombre, le schéma « Couleurs » passe sur fond anthracite. */
export function couleursSchema(s: Schema, sombre: boolean): Couleurs {
  const c = SCHEMAS[s].c;
  if (s === 'couleurs' && sombre) return { ...c, fond: '#151924', texte: '#c8ccd6', grille: '#232836', bid: '#8a93a6' };
  return c;
}
