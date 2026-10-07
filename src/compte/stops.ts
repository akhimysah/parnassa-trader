/**
 * Aide à la saisie des stop-loss / take-profit : pas d'incrément utile, premier niveau proposé du bon côté du prix,
 * et explication claire quand un niveau est refusé.
 */
import { formaterPrix, point, type SymboleMT } from '../marche/symboles';
import type { Sens } from './moteur';

/** Pas des boutons − / + : environ 0,01 % du prix, arrondi à une puissance de 10 (1 pip en EURUSD, 0,10 $ sur l'or). */
export function pasStop(s: SymboleMT, prix: number): number {
  const brut = Math.pow(10, Math.floor(Math.log10(Math.max(prix, point(s)) * 0.0001)));
  return Math.max(point(s), Number(brut.toFixed(s.chiffres)));
}

/** Premier niveau proposé : à environ 0,2 % du prix, du côté valide pour le sens de la position. */
export function amorceStop(s: SymboleMT, prix: number, sens: Sens, role: 'sl' | 'tp'): number {
  const pas = pasStop(s, prix);
  const distance = Math.max(pas * 10, Math.round((prix * 0.002) / pas) * pas);
  const versLeBas = (sens === 'buy') === (role === 'sl');
  return Number((versLeBas ? prix - distance : prix + distance).toFixed(s.chiffres));
}

/** Pourquoi un S/L ou un T/P est refusé (null s'il est valide). `prix` : prix de référence (clôture ou entrée). */
export function erreurStop(s: SymboleMT, sens: Sens, prix: number, role: 'sl' | 'tp', valeur: number): string | null {
  if (!valeur) return null;
  const f = formaterPrix(s, prix);
  const achat = sens === 'buy';
  if (role === 'sl' && achat && valeur >= prix) return `Le S/L d'un achat doit être sous ${f}`;
  if (role === 'sl' && !achat && valeur <= prix) return `Le S/L d'une vente doit être au-dessus de ${f}`;
  if (role === 'tp' && achat && valeur <= prix) return `Le T/P d'un achat doit être au-dessus de ${f}`;
  if (role === 'tp' && !achat && valeur >= prix) return `Le T/P d'une vente doit être sous ${f}`;
  return null;
}
