import type { Bougie } from '../marche/bougies';

export type TypeIndicateur =
  | 'ma' | 'bb' | 'env' | 'sar' | 'ichimoku' | 'dema' | 'tema' | 'adx' | 'stddev'
  | 'rsi' | 'macd' | 'stoch' | 'atr' | 'cci' | 'mom' | 'wpr' | 'demarker' | 'force' | 'osma' | 'bears' | 'bulls' | 'rvi'
  | 'alligator' | 'fractals' | 'ao' | 'ac'
  | 'volumes' | 'obv' | 'mfi';
export type MethodeMA = 'sma' | 'ema' | 'smma' | 'lwma';

export interface Indicateur {
  id: string;
  type: TypeIndicateur;
  /** Paramètres numériques (période, écart, etc.). */
  p: Record<string, number>;
  methode?: MethodeMA;
  couleur: string;
  /** « Appliquer à » de MT5 : prix utilisé, ou données d'un autre indicateur du graphique. */
  source?: Source;
  /** Niveaux horizontaux choisis (onglet « Niveaux » de MT5) ; à défaut, ceux de l'indicateur. */
  niveaux?: number[];
  /** Épaisseur des lignes (1 à 4). */
  epaisseur?: number;
}

export type Source = 'close' | 'open' | 'high' | 'low' | 'median' | 'typique' | 'pondere' | 'precedent' | 'premier';
export const SOURCES: Record<Source, string> = {
  close: 'Clôture',
  open: 'Ouverture',
  high: 'Plus haut',
  low: 'Plus bas',
  median: 'Prix médian (HL/2)',
  typique: 'Prix typique (HLC/3)',
  pondere: 'Clôture pondérée (HLCC/4)',
  precedent: "Données de l'indicateur précédent",
  premier: 'Données du premier indicateur',
};
/** Indicateurs calculés sur une seule série : ils acceptent « Appliquer à ». */
export const APPLICABLES: TypeIndicateur[] = ['ma', 'bb', 'env', 'dema', 'tema', 'stddev', 'rsi', 'macd', 'osma', 'mom'];
const sourceIndicateur = (s?: Source) => s === 'precedent' || s === 'premier';

function prixSource(b: Bougie[], s: Source = 'close'): Valeurs {
  switch (s) {
    case 'open':
      return b.map((x) => x.open);
    case 'high':
      return b.map((x) => x.high);
    case 'low':
      return b.map((x) => x.low);
    case 'median':
      return b.map((x) => (x.high + x.low) / 2);
    case 'typique':
      return b.map((x) => (x.high + x.low + x.close) / 3);
    case 'pondere':
      return b.map((x) => (x.high + x.low + 2 * x.close) / 4);
    default:
      return b.map((x) => x.close);
  }
}

/** Fenêtre de chaque indicateur (0 = graphique principal), sans rien calculer. */
export function panneauxIndicateurs(liste: Indicateur[]): number[] {
  const r: number[] = [];
  let n = 0;
  liste.forEach((ind, i) => {
    const ref = ind.source === 'precedent' ? r[i - 1] : ind.source === 'premier' ? r[0] : undefined;
    r.push(APPLICABLES.includes(ind.type) && sourceIndicateur(ind.source) && i > 0 && ref !== undefined ? ref : definition(ind.type).superpose ? 0 : ++n);
  });
  return r;
}

/**
 * Calcule tous les indicateurs d'un graphique dans l'ordre : un indicateur appliqué aux données du précédent (ou du
 * premier) reçoit leur première courbe, et se dessine dans la même fenêtre.
 */
export function calculerTous(liste: Indicateur[], b: Bougie[]): { resultat: Resultat; panneau: number }[] {
  const sortie: { resultat: Resultat; panneau: number }[] = [];
  let panneaux = 0;
  liste.forEach((ind, i) => {
    const ref = ind.source === 'precedent' ? sortie[i - 1] : ind.source === 'premier' ? sortie[0] : undefined;
    const applicable = APPLICABLES.includes(ind.type) && sourceIndicateur(ind.source) && ref && i > 0;
    const resultat = calculer(ind, b, applicable ? ref.resultat.traces[0]?.valeurs : undefined);
    // Sur des données d'indicateur, l'échelle est celle de l'indicateur source : pas de bornes fixes propres.
    if (applicable) delete resultat.bornes;
    const panneau = applicable ? ref.panneau : definition(ind.type).superpose ? 0 : ++panneaux;
    sortie.push({ resultat, panneau });
  });
  return sortie;
}

export const GROUPES = ['Tendance', 'Oscillateurs', 'Volumes', 'Bill Williams'] as const;
export type GroupeIndicateur = (typeof GROUPES)[number];

export interface DefinitionIndicateur {
  type: TypeIndicateur;
  nom: string;
  groupe: GroupeIndicateur;
  /** Dessiné sur le graphique principal (sinon dans une sous-fenêtre). */
  superpose: boolean;
  defaut: Record<string, number>;
  libelles: Record<string, string>;
  couleur: string;
}

export const DEFINITIONS: DefinitionIndicateur[] = [
  { type: 'ma', nom: 'Moving Average', groupe: 'Tendance', superpose: true, defaut: { periode: 14, decalage: 0 }, libelles: { periode: 'Période', decalage: 'Décalage' }, couleur: '#ff3b30' },
  { type: 'bb', nom: 'Bollinger Bands', groupe: 'Tendance', superpose: true, defaut: { periode: 20, ecarts: 2 }, libelles: { periode: 'Période', ecarts: 'Écarts types' }, couleur: '#20b2aa' },
  { type: 'env', nom: 'Envelopes', groupe: 'Tendance', superpose: true, defaut: { periode: 14, ecart: 0.1 }, libelles: { periode: 'Période', ecart: 'Écart (%)' }, couleur: '#1e90ff' },
  { type: 'sar', nom: 'Parabolic SAR', groupe: 'Tendance', superpose: true, defaut: { pas: 0.02, max: 0.2 }, libelles: { pas: 'Pas', max: 'Maximum' }, couleur: '#7cfc00' },
  { type: 'ichimoku', nom: 'Ichimoku Kinko Hyo', groupe: 'Tendance', superpose: true, defaut: { tenkan: 9, kijun: 26, senkou: 52 }, libelles: { tenkan: 'Tenkan-sen', kijun: 'Kijun-sen', senkou: 'Senkou Span B' }, couleur: '#ff4500' },
  { type: 'rsi', nom: 'Relative Strength Index', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'macd', nom: 'MACD', groupe: 'Oscillateurs', superpose: false, defaut: { rapide: 12, lente: 26, signal: 9 }, libelles: { rapide: 'EMA rapide', lente: 'EMA lente', signal: 'SMA du signal' }, couleur: '#a9a9a9' },
  { type: 'stoch', nom: 'Stochastic Oscillator', groupe: 'Oscillateurs', superpose: false, defaut: { k: 5, d: 3, ralenti: 3 }, libelles: { k: 'Période %K', d: 'Période %D', ralenti: 'Ralentissement' }, couleur: '#20b2aa' },
  { type: 'atr', nom: 'Average True Range', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'cci', nom: 'Commodity Channel Index', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#20b2aa' },
  { type: 'mom', nom: 'Momentum', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'wpr', nom: "Williams' Percent Range", groupe: 'Oscillateurs', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'dema', nom: 'Double Exponential Moving Average', groupe: 'Tendance', superpose: true, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#ff8c00' },
  { type: 'tema', nom: 'Triple Exponential Moving Average', groupe: 'Tendance', superpose: true, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#da70d6' },
  { type: 'adx', nom: 'Average Directional Movement Index', groupe: 'Tendance', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#20b2aa' },
  { type: 'stddev', nom: 'Standard Deviation', groupe: 'Tendance', superpose: false, defaut: { periode: 20 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'demarker', nom: 'DeMarker', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'force', nom: 'Force Index', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 13 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'osma', nom: 'Moving Average of Oscillator', groupe: 'Oscillateurs', superpose: false, defaut: { rapide: 12, lente: 26, signal: 9 }, libelles: { rapide: 'EMA rapide', lente: 'EMA lente', signal: 'SMA du signal' }, couleur: '#c0c0c0' },
  { type: 'bears', nom: 'Bears Power', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 13 }, libelles: { periode: 'Période' }, couleur: '#c0c0c0' },
  { type: 'bulls', nom: 'Bulls Power', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 13 }, libelles: { periode: 'Période' }, couleur: '#c0c0c0' },
  { type: 'rvi', nom: 'Relative Vigor Index', groupe: 'Oscillateurs', superpose: false, defaut: { periode: 10 }, libelles: { periode: 'Période' }, couleur: '#32cd32' },
  { type: 'volumes', nom: 'Volumes', groupe: 'Volumes', superpose: false, defaut: {}, libelles: {}, couleur: '#32cd32' },
  { type: 'obv', nom: 'On Balance Volume', groupe: 'Volumes', superpose: false, defaut: {}, libelles: {}, couleur: '#1e90ff' },
  { type: 'mfi', nom: 'Money Flow Index', groupe: 'Volumes', superpose: false, defaut: { periode: 14 }, libelles: { periode: 'Période' }, couleur: '#1e90ff' },
  { type: 'alligator', nom: 'Alligator', groupe: 'Bill Williams', superpose: true, defaut: { machoire: 13, dents: 8, levres: 5 }, libelles: { machoire: 'Mâchoire', dents: 'Dents', levres: 'Lèvres' }, couleur: '#1e90ff' },
  { type: 'fractals', nom: 'Fractals', groupe: 'Bill Williams', superpose: true, defaut: {}, libelles: {}, couleur: '#808080' },
  { type: 'ao', nom: 'Awesome Oscillator', groupe: 'Bill Williams', superpose: false, defaut: {}, libelles: {}, couleur: '#32cd32' },
  { type: 'ac', nom: 'Accelerator Oscillator', groupe: 'Bill Williams', superpose: false, defaut: {}, libelles: {}, couleur: '#32cd32' },
];

export function definition(type: TypeIndicateur): DefinitionIndicateur {
  return DEFINITIONS.find((d) => d.type === type)!;
}

export function nomCourt(i: Indicateur): string {
  const p = i.p;
  switch (i.type) {
    case 'ma':
      return `MA(${p.periode}) ${(i.methode ?? 'sma').toUpperCase()}`;
    case 'bb':
      return `Bands(${p.periode}, ${p.ecarts})`;
    case 'env':
      return `Env(${p.periode}, ${p.ecart})`;
    case 'sar':
      return `SAR(${p.pas}, ${p.max})`;
    case 'ichimoku':
      return `Ichimoku(${p.tenkan}, ${p.kijun}, ${p.senkou})`;
    case 'rsi':
      return `RSI(${p.periode})`;
    case 'macd':
      return `MACD(${p.rapide}, ${p.lente}, ${p.signal})`;
    case 'stoch':
      return `Stoch(${p.k}, ${p.d}, ${p.ralenti})`;
    case 'atr':
      return `ATR(${p.periode})`;
    case 'cci':
      return `CCI(${p.periode})`;
    case 'mom':
      return `Momentum(${p.periode})`;
    case 'wpr':
      return `WPR(${p.periode})`;
    case 'volumes':
      return 'Volumes';
    case 'dema':
      return `DEMA(${p.periode})`;
    case 'tema':
      return `TEMA(${p.periode})`;
    case 'adx':
      return `ADX(${p.periode})`;
    case 'stddev':
      return `StdDev(${p.periode})`;
    case 'demarker':
      return `DeM(${p.periode})`;
    case 'force':
      return `Force(${p.periode})`;
    case 'osma':
      return `OsMA(${p.rapide}, ${p.lente}, ${p.signal})`;
    case 'bears':
      return `Bears(${p.periode})`;
    case 'bulls':
      return `Bulls(${p.periode})`;
    case 'rvi':
      return `RVI(${p.periode})`;
    case 'obv':
      return 'OBV';
    case 'mfi':
      return `MFI(${p.periode})`;
    case 'alligator':
      return `Alligator(${p.machoire}, ${p.dents}, ${p.levres})`;
    case 'fractals':
      return 'Fractals';
    case 'ao':
      return 'AO';
    case 'ac':
      return 'AC';
  }
}

export type Valeurs = (number | null)[];

/** Une courbe calculée : valeurs alignées sur les bougies, style de tracé et niveaux horizontaux. */
export interface Trace {
  nom: string;
  valeurs: Valeurs;
  couleur: string;
  style?: 'ligne' | 'histogramme' | 'points';
  /** Couleurs par barre (histogramme des volumes, MACD). */
  couleurs?: string[];
}

export interface Resultat {
  traces: Trace[];
  niveaux?: number[];
  /** Bornes fixes de l'échelle (RSI, stochastique…). */
  bornes?: [number, number];
}

function sma(v: Valeurs, n: number): Valeurs {
  const r: Valeurs = new Array(v.length).fill(null);
  let somme = 0;
  let compte = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x === null) continue;
    somme += x;
    compte++;
    if (compte > n) somme -= v[i - n] ?? 0;
    if (compte >= n) r[i] = somme / n;
  }
  return r;
}

function ema(v: Valeurs, n: number, alpha = 2 / (n + 1)): Valeurs {
  const r: Valeurs = new Array(v.length).fill(null);
  let prec: number | null = null;
  let amorce: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x === null) continue;
    if (prec === null) {
      amorce.push(x);
      if (amorce.length === n) {
        prec = amorce.reduce((a, b) => a + b, 0) / n;
        r[i] = prec;
        amorce = [];
      }
      continue;
    }
    prec = prec + alpha * (x - prec);
    r[i] = prec;
  }
  return r;
}

function lwma(v: Valeurs, n: number): Valeurs {
  const r: Valeurs = new Array(v.length).fill(null);
  const poids = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const x = v[i - k];
      if (x === null) {
        ok = false;
        break;
      }
      s += x * (n - k);
    }
    if (ok) r[i] = s / poids;
  }
  return r;
}

export function moyenne(v: Valeurs, n: number, m: MethodeMA = 'sma'): Valeurs {
  if (m === 'ema') return ema(v, n);
  if (m === 'smma') return ema(v, n, 1 / n);
  if (m === 'lwma') return lwma(v, n);
  return sma(v, n);
}

function ecartType(v: Valeurs, moy: Valeurs, n: number): Valeurs {
  return v.map((_, i) => {
    const m = moy[i];
    if (m === null || i < n - 1) return null;
    let s = 0;
    for (let k = 0; k < n; k++) s += ((v[i - k] ?? m) - m) ** 2;
    return Math.sqrt(s / n);
  });
}

function decaler(v: Valeurs, d: number): Valeurs {
  if (!d) return v;
  const r: Valeurs = new Array(v.length).fill(null);
  for (let i = 0; i < v.length; i++) if (i + d >= 0 && i + d < v.length) r[i + d] = v[i];
  return r;
}

function plusHautBas(b: Bougie[], n: number, i: number): [number, number] {
  let h = -Infinity;
  let l = Infinity;
  for (let k = Math.max(0, i - n + 1); k <= i; k++) {
    h = Math.max(h, b[k].high);
    l = Math.min(l, b[k].low);
  }
  return [h, l];
}

export function calculer(ind: Indicateur, b: Bougie[], donnees?: Valeurs): Resultat {
  const c: Valeurs = donnees ?? (APPLICABLES.includes(ind.type) && !sourceIndicateur(ind.source) ? prixSource(b, ind.source) : b.map((x) => x.close));
  const p = ind.p;
  switch (ind.type) {
    case 'ma':
      return { traces: [{ nom: nomCourt(ind), valeurs: decaler(moyenne(c, p.periode, ind.methode), p.decalage), couleur: ind.couleur }] };
    case 'bb': {
      const m = sma(c, p.periode);
      const e = ecartType(c, m, p.periode);
      return {
        traces: [
          { nom: 'Milieu', valeurs: m, couleur: ind.couleur },
          { nom: 'Haut', valeurs: m.map((x, i) => (x === null || e[i] === null ? null : x + p.ecarts * e[i]!)), couleur: ind.couleur },
          { nom: 'Bas', valeurs: m.map((x, i) => (x === null || e[i] === null ? null : x - p.ecarts * e[i]!)), couleur: ind.couleur },
        ],
      };
    }
    case 'env': {
      const m = moyenne(c, p.periode, ind.methode);
      return {
        traces: [
          { nom: 'Haut', valeurs: m.map((x) => (x === null ? null : x * (1 + p.ecart / 100))), couleur: '#1e90ff' },
          { nom: 'Bas', valeurs: m.map((x) => (x === null ? null : x * (1 - p.ecart / 100))), couleur: '#ff3b30' },
        ],
      };
    }
    case 'sar': {
      const r: Valeurs = new Array(b.length).fill(null);
      if (b.length < 2) return { traces: [] };
      let hausse = b[1].close >= b[0].close;
      let sar = hausse ? b[0].low : b[0].high;
      let ep = hausse ? b[0].high : b[0].low;
      let af = p.pas;
      for (let i = 1; i < b.length; i++) {
        sar = sar + af * (ep - sar);
        if (hausse) {
          sar = Math.min(sar, b[i - 1].low, b[Math.max(0, i - 2)].low);
          if (b[i].low < sar) {
            hausse = false;
            sar = ep;
            ep = b[i].low;
            af = p.pas;
          } else if (b[i].high > ep) {
            ep = b[i].high;
            af = Math.min(p.max, af + p.pas);
          }
        } else {
          sar = Math.max(sar, b[i - 1].high, b[Math.max(0, i - 2)].high);
          if (b[i].high > sar) {
            hausse = true;
            sar = ep;
            ep = b[i].high;
            af = p.pas;
          } else if (b[i].low < ep) {
            ep = b[i].low;
            af = Math.min(p.max, af + p.pas);
          }
        }
        r[i] = sar;
      }
      return { traces: [{ nom: 'SAR', valeurs: r, couleur: ind.couleur, style: 'points' }] };
    }
    case 'ichimoku': {
      const milieu = (n: number) => b.map((_, i) => (i < n - 1 ? null : (() => { const [h, l] = plusHautBas(b, n, i); return (h + l) / 2; })()));
      const tenkan = milieu(p.tenkan);
      const kijun = milieu(p.kijun);
      const spanA = decaler(tenkan.map((t, i) => (t === null || kijun[i] === null ? null : (t + kijun[i]!) / 2)), p.kijun);
      const spanB = decaler(milieu(p.senkou), p.kijun);
      const chikou = decaler(c, -p.kijun);
      return {
        traces: [
          { nom: 'Tenkan-sen', valeurs: tenkan, couleur: '#ff3b30' },
          { nom: 'Kijun-sen', valeurs: kijun, couleur: '#1e90ff' },
          { nom: 'Senkou Span A', valeurs: spanA, couleur: '#f4a460' },
          { nom: 'Senkou Span B', valeurs: spanB, couleur: '#dda0dd' },
          { nom: 'Chikou Span', valeurs: chikou, couleur: '#32cd32' },
        ],
      };
    }
    case 'rsi': {
      const r: Valeurs = new Array(b.length).fill(null);
      let gain = 0;
      let perte = 0;
      // Sur la série `c` (prix choisi ou données d'un indicateur) : les valeurs absentes du début sont sautées.
      const premier = c.findIndex((x) => x !== null);
      if (premier < 0) return { traces: [{ nom: nomCourt(ind), valeurs: r, couleur: ind.couleur }], niveaux: [30, 70], bornes: [0, 100] };
      for (let i = premier + 1; i < b.length; i++) {
        const d = (c[i] ?? 0) - (c[i - 1] ?? 0);
        const k = i - premier;
        if (k <= p.periode) {
          gain += Math.max(0, d);
          perte += Math.max(0, -d);
          if (k === p.periode) {
            gain /= p.periode;
            perte /= p.periode;
            r[i] = perte === 0 ? 100 : 100 - 100 / (1 + gain / perte);
          }
          continue;
        }
        gain = (gain * (p.periode - 1) + Math.max(0, d)) / p.periode;
        perte = (perte * (p.periode - 1) + Math.max(0, -d)) / p.periode;
        r[i] = perte === 0 ? 100 : 100 - 100 / (1 + gain / perte);
      }
      return { traces: [{ nom: nomCourt(ind), valeurs: r, couleur: ind.couleur }], niveaux: [30, 70], bornes: [0, 100] };
    }
    case 'macd': {
      const rapide = ema(c, p.rapide);
      const lente = ema(c, p.lente);
      const macd = rapide.map((x, i) => (x === null || lente[i] === null ? null : x - lente[i]!));
      const signal = sma(macd, p.signal);
      return {
        traces: [
          { nom: 'MACD', valeurs: macd, couleur: '#a9a9a9', style: 'histogramme' },
          { nom: 'Signal', valeurs: signal, couleur: '#ff3b30' },
        ],
        niveaux: [0],
      };
    }
    case 'stoch': {
      const brut: Valeurs = b.map((x, i) => {
        if (i < p.k - 1) return null;
        const [h, l] = plusHautBas(b, p.k, i);
        return h === l ? 50 : ((x.close - l) / (h - l)) * 100;
      });
      // Ralentissement façon MT5 : rapport des sommes sur `ralenti` barres.
      const k: Valeurs = b.map((_, i) => {
        if (i < p.k + p.ralenti - 2) return null;
        let haut = 0;
        let bas = 0;
        for (let j = 0; j < p.ralenti; j++) {
          const [h, l] = plusHautBas(b, p.k, i - j);
          haut += b[i - j].close - l;
          bas += h - l;
        }
        return bas === 0 ? (brut[i] ?? 50) : (haut / bas) * 100;
      });
      return {
        traces: [
          { nom: 'Main', valeurs: k, couleur: '#20b2aa' },
          { nom: 'Signal', valeurs: sma(k, p.d), couleur: '#ff3b30' },
        ],
        niveaux: [20, 80],
        bornes: [0, 100],
      };
    }
    case 'atr': {
      const tr: Valeurs = b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high, b[i - 1].close) - Math.min(x.low, b[i - 1].close)));
      return { traces: [{ nom: nomCourt(ind), valeurs: sma(tr, p.periode), couleur: ind.couleur }] };
    }
    case 'cci': {
      const tp: Valeurs = b.map((x) => (x.high + x.low + x.close) / 3);
      const m = sma(tp, p.periode);
      const r = tp.map((x, i) => {
        if (m[i] === null) return null;
        let d = 0;
        for (let k = 0; k < p.periode; k++) d += Math.abs((tp[i - k] ?? 0) - m[i]!);
        d /= p.periode;
        return d === 0 ? 0 : (x! - m[i]!) / (0.015 * d);
      });
      return { traces: [{ nom: nomCourt(ind), valeurs: r, couleur: ind.couleur }], niveaux: [-100, 100] };
    }
    case 'mom':
      return { traces: [{ nom: nomCourt(ind), valeurs: c.map((x, i) => (i < p.periode || x === null || !c[i - p.periode] ? null : (x / c[i - p.periode]!) * 100)), couleur: ind.couleur }], niveaux: [100] };
    case 'wpr': {
      const r = b.map((x, i) => {
        if (i < p.periode - 1) return null;
        const [h, l] = plusHautBas(b, p.periode, i);
        return h === l ? -50 : ((h - x.close) / (h - l)) * -100;
      });
      return { traces: [{ nom: nomCourt(ind), valeurs: r, couleur: ind.couleur }], niveaux: [-20, -80], bornes: [-100, 0] };
    }
    case 'dema': {
      const e1 = ema(c, p.periode);
      const e2 = ema(e1, p.periode);
      return { traces: [{ nom: nomCourt(ind), valeurs: e1.map((x, i) => (x === null || e2[i] === null ? null : 2 * x - e2[i]!)), couleur: ind.couleur }] };
    }
    case 'tema': {
      const e1 = ema(c, p.periode);
      const e2 = ema(e1, p.periode);
      const e3 = ema(e2, p.periode);
      return { traces: [{ nom: nomCourt(ind), valeurs: e1.map((x, i) => (x === null || e2[i] === null || e3[i] === null ? null : 3 * x - 3 * e2[i]! + e3[i]!)), couleur: ind.couleur }] };
    }
    case 'adx': {
      // Wilder : +DM / -DM et vrai range lissés, DX puis sa moyenne lissée.
      const n = p.periode;
      const plus: Valeurs = new Array(b.length).fill(null);
      const moins: Valeurs = new Array(b.length).fill(null);
      const adx: Valeurs = new Array(b.length).fill(null);
      let tr = 0;
      let dmp = 0;
      let dmm = 0;
      let moy: number | null = null;
      const dxs: number[] = [];
      for (let i = 1; i < b.length; i++) {
        const haut = b[i].high - b[i - 1].high;
        const bas = b[i - 1].low - b[i].low;
        const p1 = haut > bas && haut > 0 ? haut : 0;
        const m1 = bas > haut && bas > 0 ? bas : 0;
        const t = Math.max(b[i].high, b[i - 1].close) - Math.min(b[i].low, b[i - 1].close);
        if (i <= n) {
          tr += t;
          dmp += p1;
          dmm += m1;
          if (i < n) continue;
        } else {
          tr = tr - tr / n + t;
          dmp = dmp - dmp / n + p1;
          dmm = dmm - dmm / n + m1;
        }
        const pdi = tr ? (100 * dmp) / tr : 0;
        const mdi = tr ? (100 * dmm) / tr : 0;
        plus[i] = pdi;
        moins[i] = mdi;
        const dx = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
        if (moy === null) {
          dxs.push(dx);
          if (dxs.length === n) moy = dxs.reduce((a, x) => a + x, 0) / n;
        } else moy = (moy * (n - 1) + dx) / n;
        adx[i] = moy;
      }
      return {
        traces: [
          { nom: 'ADX', valeurs: adx, couleur: '#20b2aa' },
          { nom: '+DI', valeurs: plus, couleur: '#32cd32' },
          { nom: '-DI', valeurs: moins, couleur: '#ff3b30' },
        ],
        niveaux: [20],
      };
    }
    case 'stddev':
      return { traces: [{ nom: nomCourt(ind), valeurs: ecartType(c, sma(c, p.periode), p.periode), couleur: ind.couleur }] };
    case 'demarker': {
      const hausse: Valeurs = b.map((x, i) => (i === 0 ? null : Math.max(0, x.high - b[i - 1].high)));
      const baisse: Valeurs = b.map((x, i) => (i === 0 ? null : Math.max(0, b[i - 1].low - x.low)));
      const mh = sma(hausse, p.periode);
      const mb = sma(baisse, p.periode);
      return { traces: [{ nom: nomCourt(ind), valeurs: mh.map((h, i) => (h === null || mb[i] === null ? null : h + mb[i]! === 0 ? 0.5 : h / (h + mb[i]!))), couleur: ind.couleur }], niveaux: [0.3, 0.7], bornes: [0, 1] };
    }
    case 'force': {
      const brut: Valeurs = b.map((x, i) => (i === 0 ? null : (x.close - b[i - 1].close) * x.volume));
      return { traces: [{ nom: nomCourt(ind), valeurs: moyenne(brut, p.periode, ind.methode ?? 'sma'), couleur: ind.couleur }], niveaux: [0] };
    }
    case 'osma': {
      const rapide = ema(c, p.rapide);
      const lente = ema(c, p.lente);
      const macd = rapide.map((x, i) => (x === null || lente[i] === null ? null : x - lente[i]!));
      const signal = sma(macd, p.signal);
      return { traces: [{ nom: 'OsMA', valeurs: macd.map((x, i) => (x === null || signal[i] === null ? null : x - signal[i]!)), couleur: ind.couleur, style: 'histogramme' }], niveaux: [0] };
    }
    case 'bears':
    case 'bulls': {
      const e = ema(c, p.periode);
      const v = b.map((x, i) => (e[i] === null ? null : (ind.type === 'bears' ? x.low : x.high) - e[i]!));
      return { traces: [{ nom: nomCourt(ind), valeurs: v, couleur: ind.couleur, style: 'histogramme' }], niveaux: [0] };
    }
    case 'rvi': {
      const pond = (f: (x: Bougie) => number): Valeurs => b.map((_, i) => (i < 3 ? null : (f(b[i]) + 2 * f(b[i - 1]) + 2 * f(b[i - 2]) + f(b[i - 3])) / 6));
      const num = sma(pond((x) => x.close - x.open), p.periode);
      const den = sma(pond((x) => x.high - x.low), p.periode);
      const rvi = num.map((x, i) => (x === null || !den[i] ? null : x / den[i]!));
      const signal = rvi.map((_, i) => (i < 3 || rvi[i] === null || rvi[i - 3] === null ? null : (rvi[i]! + 2 * rvi[i - 1]! + 2 * rvi[i - 2]! + rvi[i - 3]!) / 6));
      return {
        traces: [
          { nom: 'RVI', valeurs: rvi, couleur: '#32cd32' },
          { nom: 'Signal', valeurs: signal, couleur: '#ff3b30' },
        ],
        niveaux: [0],
      };
    }
    case 'obv': {
      let total = 0;
      return { traces: [{ nom: 'OBV', valeurs: b.map((x, i) => (i === 0 ? (total = 0) : (total += x.close > b[i - 1].close ? x.volume : x.close < b[i - 1].close ? -x.volume : 0))), couleur: ind.couleur }] };
    }
    case 'mfi': {
      const tp = b.map((x) => (x.high + x.low + x.close) / 3);
      const r = b.map((_, i) => {
        if (i < p.periode) return null;
        let pos = 0;
        let neg = 0;
        for (let k = i - p.periode + 1; k <= i; k++) {
          const flux = tp[k] * b[k].volume;
          if (tp[k] > tp[k - 1]) pos += flux;
          else if (tp[k] < tp[k - 1]) neg += flux;
        }
        return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
      });
      return { traces: [{ nom: nomCourt(ind), valeurs: r, couleur: ind.couleur }], niveaux: [20, 80], bornes: [0, 100] };
    }
    case 'alligator': {
      // Lissages SMMA du prix médian, décalés vers l'avenir (8, 5, 3 barres).
      const median: Valeurs = b.map((x) => (x.high + x.low) / 2);
      return {
        traces: [
          { nom: 'Mâchoire', valeurs: decaler(moyenne(median, p.machoire, 'smma'), 8), couleur: '#1e90ff' },
          { nom: 'Dents', valeurs: decaler(moyenne(median, p.dents, 'smma'), 5), couleur: '#ff3b30' },
          { nom: 'Lèvres', valeurs: decaler(moyenne(median, p.levres, 'smma'), 3), couleur: '#32cd32' },
        ],
      };
    }
    case 'fractals': {
      const haut: Valeurs = new Array(b.length).fill(null);
      const bas: Valeurs = new Array(b.length).fill(null);
      for (let i = 2; i < b.length - 2; i++) {
        const h = b[i].high;
        const l = b[i].low;
        if (h > b[i - 1].high && h > b[i - 2].high && h > b[i + 1].high && h > b[i + 2].high) haut[i] = h;
        if (l < b[i - 1].low && l < b[i - 2].low && l < b[i + 1].low && l < b[i + 2].low) bas[i] = l;
      }
      return {
        traces: [
          { nom: 'Fractale haute', valeurs: haut, couleur: '#808080', style: 'points' },
          { nom: 'Fractale basse', valeurs: bas, couleur: '#808080', style: 'points' },
        ],
      };
    }
    case 'ao':
    case 'ac': {
      const median: Valeurs = b.map((x) => (x.high + x.low) / 2);
      const s5 = sma(median, 5);
      const s34 = sma(median, 34);
      const ao = s5.map((x, i) => (x === null || s34[i] === null ? null : x - s34[i]!));
      const s5ao = sma(ao, 5);
      const v = ind.type === 'ao' ? ao : ao.map((x, i) => (x === null || s5ao[i] === null ? null : x - s5ao[i]!));
      return {
        traces: [{ nom: nomCourt(ind), valeurs: v, couleur: ind.couleur, style: 'histogramme', couleurs: v.map((x, i) => (i > 0 && x !== null && v[i - 1] !== null && x < v[i - 1]! ? '#ff3b30' : '#32cd32')) }],
        niveaux: [0],
      };
    }
    case 'volumes':
      return {
        traces: [
          {
            nom: 'Volumes',
            valeurs: b.map((x) => x.volume),
            couleur: ind.couleur,
            style: 'histogramme',
            couleurs: b.map((x, i) => (i > 0 && x.volume < b[i - 1].volume ? '#ff3b30' : '#32cd32')),
          },
        ],
      };
  }
}
