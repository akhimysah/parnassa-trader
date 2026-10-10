/** Commandes exposées par chaque fenêtre graphique montée (zoom, capture…), appelées depuis les menus. */
export interface CommandesGraphique {
  zoomer: (facteur: number) => void;
  capturer: () => void;
  allerALaFin: () => void;
  recharger: () => void;
  /** Place le réticule à ce temps (curseur synchronisé entre graphiques) ; null l'efface. */
  croix: (temps: number | null) => void;
}

export const registreGraphiques = new Map<string, CommandesGraphique>();
