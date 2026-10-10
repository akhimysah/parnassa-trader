import type { IChartApi, ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesType, Time } from 'lightweight-charts';
import type { ObjetGraphique } from '../etat';
import type { Evenement } from '../marche/calendrier';

type CanvasRenderingTarget2D = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** Objets dessinés sur le canevas du graphique (ceux qui ne sont pas de simples lignes de prix). */
export const TYPES_DESSINES: ObjetGraphique['type'][] = [
  'tendance', 'verticale', 'rectangle', 'canal', 'texte',
  'fourchette', 'regression', 'fiboExtension', 'fiboEventail', 'fiboTemps', 'gann', 'elliott', 'flecheHaut', 'flecheBas', 'triangle', 'ellipse', 'cycles',
];

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
  private evenements: Evenement[] = [];
  /** Trades passés : segment pointillé de l'entrée à la sortie (bleu si gagnant, rouge sinon), comme MT5. */
  private trajets: { t1: number; p1: number; t2: number; p2: number; gagnant: boolean }[] = [];
  /** Séparateurs de périodes : jour, semaine, mois ou année selon la période du graphique (0 = masqués). */
  private separateurs: 'jour' | 'semaine' | 'mois' | 'annee' | null = null;
  private couleurSeparateur = '#8a8a8a';
  /** Bandeau des séances (Tokyo, Londres, New York) au bas du graphique, en périodes intrajournalières. */
  private seances = false;
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

  /** Clôtures des barres (canal de régression). */
  private clotures: number[] = [];

  definir(objets: ObjetGraphique[], temps: number[], clotures: number[] = []) {
    this.objets = objets.filter((o) => TYPES_DESSINES.includes(o.type));
    this.ancrables = objets.filter((o) => o.type !== 'horizontale');
    this.temps = temps;
    this.clotures = clotures;
    this.demander?.();
  }

  definirTrajets(t: { t1: number; p1: number; t2: number; p2: number; gagnant: boolean }[]) {
    this.trajets = t;
    this.demander?.();
  }

  definirSeances(actives: boolean) {
    this.seances = actives;
    this.demander?.();
  }

  definirSeparateurs(unite: 'jour' | 'semaine' | 'mois' | 'annee' | null, couleur: string) {
    this.separateurs = unite;
    this.couleurSeparateur = couleur;
    this.demander?.();
  }

  /** Annonces du calendrier économique, marquées au bas du graphique comme dans MT5. */
  definirEvenements(e: Evenement[]) {
    this.evenements = e;
    this.demander?.();
  }

  /** Annonce sous le pointeur (marque du bas du graphique). */
  evenementProche(x: number, y: number, hauteur: number): Evenement[] {
    if (Math.abs(y - (hauteur - 12)) > 9) return [];
    return this.evenements.filter((e) => {
      const ex = this.x(e.date / 1000);
      return ex !== null && Math.abs(ex - x) <= 8;
    });
  }

  /** Objets des études MT5 : fourchette d'Andrews, régression, Fibonacci, Gann, Elliott, flèches, formes, cycles. */
  private dessinerAvance(ctx: CanvasRenderingContext2D, o: ObjetGraphique, largeur: number, hauteur: number) {
    const [a, b, c] = o.points;
    const tFin = (this.temps[this.temps.length - 1] ?? a.t) + Math.max(3600, Math.abs((b?.t ?? a.t) - a.t)) * 3;
    const segment = (t1: number, p1: number, t2: number, p2: number, pointille = false) => {
      const x1 = this.x(t1);
      const x2 = this.x(t2);
      const y1 = this.y(p1);
      const y2 = this.y(p2);
      if (x1 === null || x2 === null || y1 === null || y2 === null) return;
      ctx.setLineDash(pointille ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    // Prolonge une droite passant par (t1, p1) et (t2, p2) jusqu'au temps tFin.
    const demiDroite = (t1: number, p1: number, t2: number, p2: number, pointille = false) => {
      const pente = (p2 - p1) / (t2 - t1 || 1);
      segment(t1, p1, tFin, p1 + pente * (tFin - t1), pointille);
    };
    const etiquette = (texte: string, t: number, prix: number, dx = 3) => {
      const x = this.x(t);
      const y = this.y(prix);
      if (x === null || y === null) return;
      ctx.font = '10px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(texte, x + dx, y - 1);
    };
    const verticale = (t: number, pointille: boolean) => {
      const x = this.x(t);
      if (x === null || x < 0 || x > largeur) return;
      ctx.setLineDash(pointille ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, hauteur);
      ctx.stroke();
    };
    switch (o.type) {
      case 'fourchette': {
        if (!b || !c) return;
        const mt = (b.t + c.t) / 2;
        const mp = (b.prix + c.prix) / 2;
        demiDroite(a.t, a.prix, mt, mp);
        const pente = (mp - a.prix) / (mt - a.t || 1);
        demiDroite(b.t, b.prix, b.t + 1, b.prix + pente);
        demiDroite(c.t, c.prix, c.t + 1, c.prix + pente);
        segment(b.t, b.prix, c.t, c.prix, true);
        return;
      }
      case 'regression': {
        if (!b) return;
        const i1 = this.temps.findIndex((t) => t >= Math.min(a.t, b.t));
        let i2 = this.temps.findIndex((t) => t > Math.max(a.t, b.t));
        if (i2 < 0) i2 = this.temps.length;
        const n = i2 - i1;
        if (i1 < 0 || n < 2) return;
        let sx = 0;
        let sy = 0;
        let sxy = 0;
        let sxx = 0;
        for (let k = 0; k < n; k++) {
          const v = this.clotures[i1 + k];
          sx += k;
          sy += v;
          sxy += k * v;
          sxx += k * k;
        }
        const pente = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
        const base = (sy - pente * sx) / n;
        let e = 0;
        for (let k = 0; k < n; k++) e += (this.clotures[i1 + k] - (base + pente * k)) ** 2;
        const ecart = Math.sqrt(e / n) * 2;
        const t1 = this.temps[i1];
        const t2 = this.temps[i2 - 1];
        for (const [d, p] of [[0, false], [ecart, true], [-ecart, true]] as const) segment(t1, base + d, t2, base + d + pente * (n - 1), p);
        return;
      }
      case 'fiboExtension': {
        if (!b || !c) return;
        segment(a.t, a.prix, b.t, b.prix, true);
        segment(b.t, b.prix, c.t, c.prix, true);
        for (const k of [0, 0.618, 1, 1.618, 2.618]) {
          const prix = c.prix + (b.prix - a.prix) * k;
          segment(c.t, prix, tFin, prix);
          etiquette(`${(k * 100).toFixed(1)}`, c.t, prix);
        }
        return;
      }
      case 'fiboEventail': {
        if (!b) return;
        segment(a.t, a.prix, b.t, b.prix, true);
        for (const k of [0.382, 0.5, 0.618]) {
          const prix = b.prix - (b.prix - a.prix) * k;
          demiDroite(a.t, a.prix, b.t, prix);
          etiquette(`${(k * 100).toFixed(1)}`, b.t, prix);
        }
        return;
      }
      case 'fiboTemps': {
        if (!b) return;
        const d = b.t - a.t;
        for (const k of [0, 1, 2, 3, 5, 8, 13, 21, 34]) verticale(a.t + d * k, k > 1);
        return;
      }
      case 'gann': {
        if (!b) return;
        const pente = (b.prix - a.prix) / (b.t - a.t || 1);
        for (const r of [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]) {
          demiDroite(a.t, a.prix, a.t + 1, a.prix + pente * r, r !== 1);
          const t = a.t + (b.t - a.t) * 1.2;
          if (r >= 1 / 4 && r <= 4) etiquette(r >= 1 ? `${r}x1` : `1x${Math.round(1 / r)}`, t, a.prix + pente * r * (t - a.t));
        }
        return;
      }
      case 'elliott': {
        for (let k = 1; k < o.points.length; k++) segment(o.points[k - 1].t, o.points[k - 1].prix, o.points[k].t, o.points[k].prix);
        const labels = ['0', '1', '2', '3', '4', '5'];
        o.points.forEach((p, k) => etiquette(`(${labels[k]})`, p.t, p.prix, -8));
        return;
      }
      case 'flecheHaut':
      case 'flecheBas': {
        const x = this.x(a.t);
        const y = this.y(a.prix);
        if (x === null || y === null) return;
        const s = o.type === 'flecheHaut' ? 1 : -1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 7, y + s * 10);
        ctx.lineTo(x - 3, y + s * 10);
        ctx.lineTo(x - 3, y + s * 20);
        ctx.lineTo(x + 3, y + s * 20);
        ctx.lineTo(x + 3, y + s * 10);
        ctx.lineTo(x + 7, y + s * 10);
        ctx.closePath();
        ctx.fill();
        return;
      }
      case 'triangle': {
        if (!b || !c) return;
        const pts = [a, b, c].map((p) => [this.x(p.t), this.y(p.prix)] as const);
        if (pts.some(([x, y]) => x === null || y === null)) return;
        ctx.setLineDash([]);
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!)));
        ctx.closePath();
        ctx.globalAlpha = 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        return;
      }
      case 'ellipse': {
        if (!b) return;
        const x1 = this.x(a.t);
        const x2 = this.x(b.t);
        const y1 = this.y(a.prix);
        const y2 = this.y(b.prix);
        if (x1 === null || x2 === null || y1 === null || y2 === null) return;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        return;
      }
      case 'cycles': {
        if (!b) return;
        const d = Math.abs(b.t - a.t);
        if (!d) return;
        for (let k = 0; k < 40; k++) verticale(Math.min(a.t, b.t) + d * k, true);
        return;
      }
    }
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
        } else if (o.type !== 'texte') {
          this.dessinerAvance(ctx, o, mediaSize.width, mediaSize.height);
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
      // Séparateurs de périodes, en heure locale comme le reste du graphique.
      if (this.separateurs && this.temps.length > 1) {
        const cle = (t: number) => {
          const d = new Date(t * 1000);
          if (this.separateurs === 'jour') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          if (this.separateurs === 'semaine') return Math.floor((t / 86400 + 3) / 7);
          if (this.separateurs === 'mois') return `${d.getFullYear()}-${d.getMonth()}`;
          return d.getFullYear();
        };
        ctx.save();
        ctx.strokeStyle = this.couleurSeparateur;
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        const ech = this.chart?.timeScale();
        const visibles = ech?.getVisibleLogicalRange();
        const debut = Math.max(1, Math.floor(visibles?.from ?? 1));
        const fin = Math.min(this.temps.length - 1, Math.ceil(visibles?.to ?? this.temps.length - 1));
        for (let i = debut; i <= fin; i++) {
          if (cle(this.temps[i]) === cle(this.temps[i - 1])) continue;
          const x = ech?.logicalToCoordinate(i as never);
          if (x === null || x === undefined) continue;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, mediaSize.height);
          ctx.stroke();
        }
        ctx.restore();
      }
      // Trajets des trades fermés.
      if (this.trajets.length) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.2;
        for (const tr of this.trajets) {
          const x1 = this.x(tr.t1);
          const x2 = this.x(tr.t2);
          const y1 = this.y(tr.p1);
          const y2 = this.y(tr.p2);
          if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
          if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > mediaSize.width) continue;
          ctx.strokeStyle = tr.gagnant ? '#1e6fd9' : '#e0393e';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.restore();
      }
      // Séances : une rangée par place, colorée pendant ses heures d'ouverture (heure locale de la place).
      if (this.seances && this.temps.length > 1) {
        const ech = this.chart?.timeScale();
        const visibles = ech?.getVisibleLogicalRange();
        const debut = Math.max(0, Math.floor(visibles?.from ?? 0));
        const fin = Math.min(this.temps.length - 1, Math.ceil(visibles?.to ?? this.temps.length - 1));
        const largeur = Math.max(1, (ech?.options().barSpacing ?? 6));
        ctx.save();
        SEANCES.forEach((se, rang) => {
          ctx.fillStyle = se.couleur;
          ctx.globalAlpha = 0.55;
          for (let i = debut; i <= fin; i++) {
            if (!ouverte(se, this.temps[i])) continue;
            const x = ech?.logicalToCoordinate(i as never);
            if (x === null || x === undefined) continue;
            ctx.fillRect(x - largeur / 2, mediaSize.height - 40 + rang * 5, largeur + 0.5, 4);
          }
        });
        // Légende à gauche, juste au-dessus du bandeau (le haut du graphique porte la légende des indicateurs).
        ctx.globalAlpha = 0.9;
        ctx.font = '9px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textBaseline = 'bottom';
        let xl = 4;
        for (const se of SEANCES) {
          ctx.fillStyle = se.couleur;
          ctx.fillText(se.nom, xl, mediaSize.height - 42);
          xl += ctx.measureText(se.nom).width + 8;
        }
        ctx.restore();
      }
      // Annonces économiques : pastille à la date, couleur selon l'importance.
      for (const e of this.evenements) {
        const x = this.x(e.date / 1000);
        if (x === null || x < -10 || x > mediaSize.width + 10) continue;
        const y = mediaSize.height - 12;
        ctx.save();
        ctx.fillStyle = e.importance >= 1 ? '#e0393e' : e.importance === 0 ? '#f0a020' : '#9a9a9a';
        ctx.globalAlpha = e.date > Date.now() ? 0.95 : 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 6, y + 4);
        ctx.lineTo(x - 6, y + 4);
        ctx.closePath();
        ctx.fill();
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
  fourchette: { points: 3, couleur: '#1e90ff', nom: "Fourchette d'Andrews" },
  regression: { points: 2, couleur: '#ff8c00', nom: 'Canal de régression linéaire' },
  fiboExtension: { points: 3, couleur: '#dc143c', nom: 'Extension de Fibonacci' },
  fiboEventail: { points: 2, couleur: '#dc143c', nom: 'Éventail de Fibonacci' },
  fiboTemps: { points: 2, couleur: '#dc143c', nom: 'Zones de temps de Fibonacci' },
  gann: { points: 2, couleur: '#2e8b57', nom: 'Éventail de Gann' },
  elliott: { points: 6, couleur: '#1e90ff', nom: "Vague d'Elliott (0 à 5)" },
  flecheHaut: { points: 1, couleur: '#1e9e3a', nom: 'Flèche vers le haut' },
  flecheBas: { points: 1, couleur: '#e0393e', nom: 'Flèche vers le bas' },
  triangle: { points: 3, couleur: '#9932cc', nom: 'Triangle' },
  ellipse: { points: 2, couleur: '#20b2aa', nom: 'Ellipse' },
  cycles: { points: 2, couleur: '#808080', nom: 'Lignes de cycles' },
};

/** Séances des grandes places, en heure locale de chacune (l'heure d'été est donc prise en compte). */
const SEANCES = [
  { nom: 'Tokyo', zone: 'Asia/Tokyo', ouverture: 9, fermeture: 18, couleur: '#e0a000' },
  { nom: 'Londres', zone: 'Europe/London', ouverture: 8, fermeture: 17, couleur: '#1e6fd9' },
  { nom: 'New York', zone: 'America/New_York', ouverture: 8, fermeture: 17, couleur: '#1e9e3a' },
];
const formats = new Map<string, Intl.DateTimeFormat>();
function heureLocale(zone: string, t: number): { heure: number; jour: number } {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
    formats.set(zone, f);
  }
  const parts = f.formatToParts(new Date(t * 1000));
  const heure = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const jour = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Mon');
  return { heure, jour };
}
// Le dessin repasse à chaque mouvement de souris : le résultat est gardé par (place, heure).
const memo = new Map<string, boolean>();
function ouverte(se: (typeof SEANCES)[number], t: number): boolean {
  const heurePile = Math.floor(t / 3600) * 3600;
  const cle = `${se.zone}|${heurePile}`;
  let r = memo.get(cle);
  if (r === undefined) {
    const { heure, jour } = heureLocale(se.zone, heurePile);
    r = jour >= 1 && jour <= 5 && heure >= se.ouverture && heure < se.fermeture;
    if (memo.size > 50000) memo.clear();
    memo.set(cle, r);
  }
  return r;
}
