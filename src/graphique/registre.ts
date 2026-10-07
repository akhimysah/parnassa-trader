/** Commandes exposées par chaque fenêtre graphique montée (zoom, capture…), appelées depuis les menus. */
export interface CommandesGraphique {
  zoomer: (facteur: number) => void;
  capturer: () => void;
  allerALaFin: () => void;
  recharger: () => void;
}

export const registreGraphiques = new Map<string, CommandesGraphique>();
