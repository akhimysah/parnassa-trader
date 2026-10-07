import type { Bougie } from '../marche/bougies';

export type TypeIndicateur = 'ma' | 'bb' | 'env' | 'sar' | 'ichimoku' | 'rsi' | 'macd' | 'stoch' | 'atr' | 'cci' | 'mom' | 'wpr' | 'volumes';
export type MethodeMA = 'sma' | 'ema' | 'smma' | 'lwma';

export interface Indicateur {
  id: string;
  type: TypeIndicateur;
  /** Paramètres numériques (période, écart, etc.). */
  p: Record<string, number>;
  methode?: MethodeMA;
  couleur: string;
}

export interface DefinitionIndicateur {
  type: TypeIndicateur;
  nom: string;
  groupe: 'Tendance' | 'Oscillateurs' | 'Volumes';
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
  { type: 'volumes', nom: 'Volumes', groupe: 'Volumes', superpose: false, defaut: {}, libelles: {}, couleur: '#32cd32' },
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

export function calculer(ind: Indicateur, b: Bougie[]): Resultat {
  const c: Valeurs = b.map((x) => x.close);
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
      for (let i = 1; i < b.length; i++) {
        const d = b[i].close - b[i - 1].close;
        if (i <= p.periode) {
          gain += Math.max(0, d);
          perte += Math.max(0, -d);
          if (i === p.periode) {
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
      return { traces: [{ nom: nomCourt(ind), valeurs: c.map((x, i) => (i < p.periode ? null : (x! / c[i - p.periode]!) * 100)), couleur: ind.couleur }], niveaux: [100] };
    case 'wpr': {
      const r = b.map((x, i) => {
        if (i < p.periode - 1) return null;
        const [h, l] = plusHautBas(b, p.periode, i);
        return h === l ? -50 : ((h - x.close) / (h - l)) * -100;
      });
      return { traces: [{ nom: nomCourt(ind), valeurs: r, couleur: ind.couleur }], niveaux: [-20, -80], bornes: [-100, 0] };
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
