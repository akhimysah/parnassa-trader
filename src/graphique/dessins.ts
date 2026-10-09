import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesType, Time } from 'lightweight-charts';
import type { ObjetGraphique } from '../etat';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** Objets dessinés sur le canevas du graphique (ceux qui ne sont pas de simples lignes de prix). */
export const TYPES_DESSINES: ObjetGraphique['type'][] = ['tendance', 'verticale', 'rectangle', 'canal', 'texte'];

/**
 * Primitive de série : lignes verticales, rectangles, canaux équidistants et textes, comme les objets de MT5.
 * Les temps sont convertis en position par l'indice de la barre, ce qui marche aussi entre deux barres et au-delà de
 * la dernière (projection d'un canal vers la droite).
 */
export class Dessins implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private serie: ISeriesApi<SeriesType> | null = null;
  private demander: (() => void) | null = null;
  private objets: ObjetGraphique[] = [];
  /** Tous les objets à poignées (sauf la ligne horizontale, qui se tire comme une ligne de prix). */
  private ancrables: ObjetGraphique[] = [];
  private selection: string | null = null;
  private temps: number[] = [];
  private readonly vue: IPrimitivePaneView;

  constructor() {
    const rendu: IPrimitivePaneRenderer = { draw: (cible) => this.dessiner(cible) };
    this.vue = { renderer: () => rendu, zOrder: () => 'top' };
  }

  attached(p: { chart: IChartApi; series: ISeriesApi<SeriesType>; requestUpdate: () => void }) {
    this.chart = p.chart;
    this.serie = p.series;
    this.demander = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.serie = null;
    this.demander = null;
  }
  paneViews() {
    return [this.vue];
  }
  updateAllViews() {}

  definir(objets: ObjetGraphique[], temps: number[]) {
    this.objets = objets.filter((o) => TYPES_DESSINES.includes(o.type));
    this.ancrables = objets.filter((o) => o.type !== 'horizontale');
    this.temps = temps;
    this.demander?.();
  }

  /** Objet sélectionné (survolé ou tiré) : ses poignées sont dessinées. */
  selectionner(id: string | null) {
    if (id === this.selection) return;
    this.selection = id;
    this.demander?.();
  }

  /** Poignée d'objet sous le pointeur (coordonnées du graphique), à 8 px près. */
  ancreProche(x: number, y: number): { id: string; index: number } | null {
    let meilleur: { id: string; index: number } | null = null;
    let distance = 8;
    for (const o of this.ancrables) {
      o.points.forEach((p, index) => {
        const px = this.x(p.t);
        // La ligne verticale se saisit sur toute sa hauteur.
        const py = o.type === 'verticale' ? y : this.y(p.prix);
        if (px === null || py === null) return;
        const d = Math.hypot(px - x, py - y);
        if (d <= distance) {
          distance = d;
          meilleur = { id: o.id, index };
        }
      });
    }
    return meilleur;
  }

  /** Objet dont le tracé passe sous le pointeur (pour le déplacer d'un bloc ou ouvrir ses propriétés). */
  corpsProche(x: number, y: number): string | null {
    const seg = (x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l));
      return Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy));
    };
    for (const o of [...this.ancrables].reverse()) {
      const [a, b, c] = o.points;
      const xa = this.x(a.t);
      const ya = this.y(a.prix);
      if (xa === null || ya === null) continue;
      if (o.type === 'texte') {
        if (x >= xa - 4 && x <= xa + 8 + 7 * (o.texte?.length ?? 0) && Math.abs(y - ya) <= 9) return o.id;
        continue;
      }
      if (!b) continue;
      const xb = this.x(b.t);
      const yb = this.y(b.prix);
      if (xb === null || yb === null) continue;
      if (o.type === 'rectangle' && x >= Math.min(xa, xb) && x <= Math.max(xa, xb) && y >= Math.min(ya, yb) && y <= Math.max(ya, yb)) return o.id;
      if (o.type === 'tendance' && seg(xa, ya, xb, yb) <= 5) return o.id;
      if (o.type === 'canal') {
        const pente = (b.prix - a.prix) / (b.t - a.t || 1);
        const decalage = c ? c.prix - (a.prix + pente * (c.t - a.t)) : 0;
        const tFin = (this.temps[this.temps.length - 1] ?? b.t) + (b.t - a.t) * 2;
        const xf = this.x(tFin);
        for (const d of [0, decalage]) {
          const y1 = this.y(a.prix + d);
          const y2 = this.y(a.prix + d + pente * (tFin - a.t));
          if (xf !== null && y1 !== null && y2 !== null && seg(xa, y1, xf, y2) <= 5) return o.id;
        }
      }
    }
    return null;
  }

  /** Temps (secondes) d'une position horizontale, interpolé entre les barres comme `x`. */
  tempsEn(x: number): number | null {
    const ts = this.temps;
    const logique = this.chart?.timeScale().coordinateToLogical(x);
    if (logique === null || logique === undefined || ts.length < 2) return null;
    const l = Number(logique);
    const n = ts.length;
    if (l <= 0) return Math.round(ts[0] + l * (ts[1] - ts[0]));
    if (l >= n - 1) return Math.round(ts[n - 1] + (l - (n - 1)) * (ts[n - 1] - ts[n - 2]));
    const i = Math.floor(l);
    return Math.round(ts[i] + (l - i) * (ts[i + 1] - ts[i]));
  }

  /** Position horizontale d'un temps : indice logique interpolé entre les barres, extrapolé au-delà. */
  private x(t: number): number | null {
    const ts = this.temps;
    const ech = this.chart?.timeScale();
    if (!ech || ts.length < 2) return null;
    let logique: number;
    if (t <= ts[0]) logique = (t - ts[0]) / (ts[1] - ts[0]);
    else if (t >= ts[ts.length - 1]) logique = ts.length - 1 + (t - ts[ts.length - 1]) / (ts[ts.length - 1] - ts[ts.length - 2]);
    else {
      let bas = 0;
      let haut = ts.length - 1;
      while (haut - bas > 1) {
        const m = (bas + haut) >> 1;
        if (ts[m] <= t) bas = m;
        else haut = m;
      }
      logique = bas + (t - ts[bas]) / (ts[haut] - ts[bas]);
    }
    return ech.logicalToCoordinate(logique as never);
  }
  private y(prix: number): number | null {
    return this.serie?.priceToCoordinate(prix) ?? null;
  }

  private dessiner(cible: CanvasRenderingTarget2D) {
    cible.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const o of this.objets) {
        ctx.save();
        ctx.strokeStyle = o.couleur;
        ctx.fillStyle = o.couleur;
        ctx.lineWidth = 1.5;
        const [a, b, c] = o.points;
        if (o.type === 'verticale') {
          const x = this.x(a.t);
          if (x !== null) {
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, 0);
            ctx.lineTo(Math.round(x) + 0.5, mediaSize.height);
            ctx.stroke();
          }
        } else if (o.type === 'tendance' && b) {
          const x1 = this.x(a.t);
          const x2 = this.x(b.t);
          const y1 = this.y(a.prix);
          const y2 = this.y(b.prix);
          if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        } else if (o.type === 'rectangle' && b) {
          const x1 = this.x(a.t);
          const x2 = this.x(b.t);
          const y1 = this.y(a.prix);
          const y2 = this.y(b.prix);
          if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
            ctx.globalAlpha = 0.15;
            ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
            ctx.globalAlpha = 1;
            ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          }
        } else if (o.type === 'canal' && b) {
          // Canal équidistant : la ligne A-B, sa parallèle passant par C, prolongées vers la droite.
          const pente = (b.prix - a.prix) / (b.t - a.t || 1);
          const decalage = c ? c.prix - (a.prix + pente * (c.t - a.t)) : 0;
          const tFin = (this.temps[this.temps.length - 1] ?? b.t) + (b.t - a.t) * 2;
          const ligne = (d: number, pointille: boolean) => {
            const x1 = this.x(a.t);
            const x2 = this.x(tFin);
            const y1 = this.y(a.prix + d);
            const y2 = this.y(a.prix + d + pente * (tFin - a.t));
            if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
            ctx.setLineDash(pointille ? [4, 3] : []);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            return [x1, y1, x2, y2] as const;
          };
          const l1 = ligne(0, false);
          const l2 = ligne(decalage, false);
          ligne(decalage / 2, true);
          if (l1 && l2) {
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.08;
            ctx.beginPath();
            ctx.moveTo(l1[0], l1[1]);
            ctx.lineTo(l1[2], l1[3]);
            ctx.lineTo(l2[2], l2[3]);
            ctx.lineTo(l2[0], l2[1]);
            ctx.closePath();
            ctx.fill();
          }
        } else if (o.type === 'texte') {
          const x = this.x(a.t);
          const y = this.y(a.prix);
          if (x !== null && y !== null) {
            ctx.font = '12px -apple-system, "Segoe UI", Roboto, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(o.texte ?? '', x + 3, y);
          }
        }
        ctx.restore();
      }
      // Poignées de l'objet sélectionné, comme MT5.
      const sel = this.ancrables.find((o) => o.id === this.selection);
      if (sel) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = sel.couleur;
        ctx.lineWidth = 1.5;
        for (const p of sel.points) {
          const x = this.x(p.t);
          const y = sel.type === 'verticale' ? mediaSize.height / 2 : this.y(p.prix);
          if (x === null || y === null) continue;
          ctx.fillRect(x - 4, y - 4, 8, 8);
          ctx.strokeRect(x - 4, y - 4, 8, 8);
        }
        ctx.restore();
      }
    });
  }
}

/** Nombre de clics pour placer chaque objet, couleur par défaut et nom affiché. */
export const OBJETS: Record<ObjetGraphique['type'], { points: number; couleur: string; nom: string }> = {
  horizontale: { points: 1, couleur: '#ff3b30', nom: 'Ligne horizontale' },
  verticale: { points: 1, couleur: '#808080', nom: 'Ligne verticale' },
  tendance: { points: 2, couleur: '#1e90ff', nom: 'Ligne de tendance' },
  canal: { points: 3, couleur: '#9932cc', nom: 'Canal équidistant' },
  fibo: { points: 2, couleur: '#dc143c', nom: 'Retracement de Fibonacci' },
  rectangle: { points: 2, couleur: '#20b2aa', nom: 'Rectangle' },
  texte: { points: 1, couleur: '#ffa500', nom: 'Texte' },
};
