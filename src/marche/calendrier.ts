import { RELAIS } from './bougies';
import type { SymboleMT } from './symboles';

/** Événement du calendrier économique (relais Parnassa). */
export interface Evenement {
  id: string;
  date: number;
  devise: string;
  importance: number;
  titre: string;
  titreFr?: string;
  actuel: number | null;
  prevision: number | null;
  precedent: number | null;
  unite: string;
  echelle: string;
}

let cache: { quand: number; promesse: Promise<Evenement[]> } | null = null;

/** Calendrier partagé par tous les graphiques, relu au plus toutes les 10 minutes. */
export function chargerCalendrier(): Promise<Evenement[]> {
  if (cache && Date.now() - cache.quand < 600_000) return cache.promesse;
  const promesse = fetch(`${RELAIS}/calendrier`)
    .then((r) => r.json() as Promise<{ evenements: Evenement[] }>)
    .then((d) => d.evenements ?? [])
    .catch(() => {
      cache = null;
      return [] as Evenement[];
    });
  cache = { quand: Date.now(), promesse };
  return promesse;
}

/** Devises dont les annonces font bouger le symbole (paire de change, sinon la devise de cotation). */
export function devisesSymbole(s: SymboleMT): string[] {
  if (s.categorie === 'forex') return [s.base, s.profit];
  if (s.categorie === 'crypto' || s.categorie === 'metaux' || s.categorie === 'energie') return ['USD'];
  return [s.profit];
}

export function valeurEvenement(x: number | null, e: Evenement): string {
  return x === null ? '—' : `${x}${e.echelle}${e.unite}`;
}
