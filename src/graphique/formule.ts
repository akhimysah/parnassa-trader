/**
 * Indicateurs personnalisés par formule (l'équivalent simple d'un indicateur MQL5) : une expression sur les séries de
 * prix et des fonctions classiques, calculée barre par barre. Exemples :
 *   ema(close, 20) - ema(close, 50)
 *   (close - sma(close, 20)) / atr(14)
 *   highest(high, 20) ; lowest(low, 20)          ← plusieurs courbes séparées par « ; »
 */
import type { Bougie } from '../marche/bougies';
import { moyenne, type Valeurs } from './indicateurs';

type Valeur = Valeurs | number;

interface Jeton {
  type: 'nombre' | 'nom' | 'op' | 'cmp' | '(' | ')' | ',';
  v: string;
}

function decouper(source: string): Jeton[] {
  const jetons: Jeton[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j++;
      jetons.push({ type: 'nombre', v: source.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) j++;
      jetons.push({ type: 'nom', v: source.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('<>=!'.includes(c)) {
      const deux = source.slice(i, i + 2);
      if (['<=', '>=', '==', '!='].includes(deux)) {
        jetons.push({ type: 'cmp', v: deux });
        i += 2;
        continue;
      }
      if (c === '<' || c === '>') jetons.push({ type: 'cmp', v: c });
      else throw new Error(`Caractère inattendu « ${c} » (comparaisons : < > <= >= == !=)`);
      i++;
      continue;
    }
    if ('+-*/'.includes(c)) jetons.push({ type: 'op', v: c });
    else if (c === '(' || c === ')' || c === ',') jetons.push({ type: c, v: c });
    else throw new Error(`Caractère inattendu « ${c} »`);
    i++;
  }
  return jetons;
}

const SERIES = ['open', 'high', 'low', 'close', 'volume', 'median', 'typical'] as const;
export const FONCTIONS: Record<string, string> = {
  sma: 'sma(x, n) — moyenne simple',
  ema: 'ema(x, n) — moyenne exponentielle',
  wma: 'wma(x, n) — moyenne pondérée',
  rsi: 'rsi(x, n) — RSI de la série',
  atr: 'atr(n) — Average True Range',
  stddev: 'stddev(x, n) — écart type',
  highest: 'highest(x, n) — plus haut sur n barres',
  lowest: 'lowest(x, n) — plus bas sur n barres',
  shift: 'shift(x, n) — valeur n barres avant',
  crossover: 'crossover(a, b) — 1 quand a passe au-dessus de b sur la barre',
  crossunder: 'crossunder(a, b) — 1 quand a passe en dessous de b sur la barre',
  iff: 'iff(condition, a, b) — a si la condition est vraie, sinon b',
  abs: 'abs(x)',
  max: 'max(a, b)',
  min: 'min(a, b)',
};

/** Calcule une formule ; renvoie une série par expression (séparées par « ; »). */
export function calculerFormule(source: string, b: Bougie[]): Valeurs[] {
  return source
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((e) => {
      const v = evaluer(e, b);
      return typeof v === 'number' ? b.map(() => v) : v;
    });
}

/** Message d'erreur lisible, ou null si la formule est correcte. */
export function erreurFormule(source: string): string | null {
  if (!source.trim()) return 'Formule vide';
  try {
    const essai: Bougie[] = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 1 + i, high: 2 + i, low: i, close: 1.5 + i, volume: 1 }));
    calculerFormule(source, essai);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Formule invalide';
  }
}

/** Évalue une expression ; `variables` : séries ou nombres déjà calculés (scripts). Vrai = 1, faux = 0. */
export function evaluerExpression(source: string, b: Bougie[], variables: Record<string, Valeurs | number> = {}): Valeurs | number {
  return evaluer(source, b, variables);
}

function evaluer(source: string, b: Bougie[], variables: Record<string, Valeurs | number> = {}): Valeur {
  const jetons = decouper(source);
  let k = 0;
  const voir = () => jetons[k];
  const prendre = () => jetons[k++];
  const attendre = (type: Jeton['type']) => {
    const j = prendre();
    if (!j || j.type !== type) throw new Error(`« ${type} » attendu`);
  };
  const n = b.length;
  const parBarre = (a: Valeur, c: Valeur, f: (x: number, y: number) => number): Valeur => {
    if (typeof a === 'number' && typeof c === 'number') return f(a, c);
    return Array.from({ length: n }, (_, i) => {
      const x = typeof a === 'number' ? a : a[i];
      const y = typeof c === 'number' ? c : c[i];
      if (x === null || y === null || x === undefined || y === undefined) return null;
      const r = f(x, y);
      return Number.isFinite(r) ? r : null;
    });
  };
  const serie = (v: Valeur): Valeurs => (typeof v === 'number' ? b.map(() => v) : v);
  const entier = (v: Valeur, nom: string) => {
    if (typeof v !== 'number' || v < 1 || v > 1000) throw new Error(`${nom} : période entière de 1 à 1000 attendue`);
    return Math.round(v);
  };
  const fenetre = (x: Valeurs, p: number, f: (l: number[]) => number): Valeurs =>
    x.map((_, i) => {
      if (i < p - 1) return null;
      const l: number[] = [];
      for (let j = i - p + 1; j <= i; j++) {
        if (x[j] === null) return null;
        l.push(x[j]!);
      }
      return f(l);
    });

  const appel = (nom: string, args: Valeur[]): Valeur => {
    const [a, c] = args;
    switch (nom) {
      case 'sma':
      case 'ema':
      case 'wma':
        return moyenne(serie(a), entier(c, nom), nom === 'sma' ? 'sma' : nom === 'ema' ? 'ema' : 'lwma');
      case 'rsi': {
        const x = serie(a);
        const p = entier(c, nom);
        const r: Valeurs = new Array(n).fill(null);
        let gain = 0;
        let perte = 0;
        let compte = 0;
        for (let i = 1; i < n; i++) {
          if (x[i] === null || x[i - 1] === null) continue;
          const d = x[i]! - x[i - 1]!;
          compte++;
          if (compte <= p) {
            gain += Math.max(0, d) / p;
            perte += Math.max(0, -d) / p;
            if (compte < p) continue;
          } else {
            gain = (gain * (p - 1) + Math.max(0, d)) / p;
            perte = (perte * (p - 1) + Math.max(0, -d)) / p;
          }
          r[i] = perte === 0 ? 100 : 100 - 100 / (1 + gain / perte);
        }
        return r;
      }
      case 'atr': {
        const p = entier(a, nom);
        const tr: Valeurs = b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high, b[i - 1].close) - Math.min(x.low, b[i - 1].close)));
        return moyenne(tr, p, 'sma');
      }
      case 'stddev':
        return fenetre(serie(a), entier(c, nom), (l) => {
          const m = l.reduce((s, v) => s + v, 0) / l.length;
          return Math.sqrt(l.reduce((s, v) => s + (v - m) ** 2, 0) / l.length);
        });
      case 'highest':
        return fenetre(serie(a), entier(c, nom), (l) => Math.max(...l));
      case 'lowest':
        return fenetre(serie(a), entier(c, nom), (l) => Math.min(...l));
      case 'shift': {
        const x = serie(a);
        const p = Math.max(0, Math.round(typeof c === 'number' ? c : 1));
        return x.map((_, i) => (i - p >= 0 ? x[i - p] : null));
      }
      case 'crossover':
      case 'crossunder': {
        const x = serie(a);
        const y = serie(c);
        return x.map((_, i) => {
          if (i === 0 || x[i] === null || y[i] === null || x[i - 1] === null || y[i - 1] === null) return null;
          return nom === 'crossover' ? Number(x[i - 1]! <= y[i - 1]! && x[i]! > y[i]!) : Number(x[i - 1]! >= y[i - 1]! && x[i]! < y[i]!);
        });
      }
      case 'iff': {
        const cond = serie(a);
        const vrai = serie(c);
        const faux = serie(args[2] ?? 0);
        return cond.map((v, i) => (v === null ? null : v !== 0 ? vrai[i] : faux[i]));
      }
      case 'abs':
        return parBarre(a, 0, (x) => Math.abs(x));
      case 'max':
        return parBarre(a, c, Math.max);
      case 'min':
        return parBarre(a, c, Math.min);
      default:
        throw new Error(`Fonction inconnue « ${nom} »`);
    }
  };

  // Grammaire : ou = et (or et)* ; et = non (and non)* ; non = not non | comparaison ;
  // comparaison = somme (< > <= >= == != somme)? ; somme = terme (± terme)* ; terme = facteur (×÷ facteur)* ;
  // facteur = nombre | série | variable | appel | (ou) | -facteur
  const motCle = (m: string) => voir()?.type === 'nom' && voir().v === m;
  const ou = (): Valeur => {
    let v = et();
    while (motCle('or')) {
      prendre();
      v = parBarre(v, et(), (x, y) => Number(x !== 0 || y !== 0));
    }
    return v;
  };
  const et = (): Valeur => {
    let v = non();
    while (motCle('and')) {
      prendre();
      v = parBarre(v, non(), (x, y) => Number(x !== 0 && y !== 0));
    }
    return v;
  };
  const non = (): Valeur => {
    if (motCle('not')) {
      prendre();
      return parBarre(non(), 0, (x) => Number(x === 0));
    }
    const v = somme();
    if (voir()?.type !== 'cmp') return v;
    const op = prendre().v;
    const d = somme();
    const f: Record<string, (x: number, y: number) => number> = {
      '<': (x, y) => Number(x < y),
      '>': (x, y) => Number(x > y),
      '<=': (x, y) => Number(x <= y),
      '>=': (x, y) => Number(x >= y),
      '==': (x, y) => Number(x === y),
      '!=': (x, y) => Number(x !== y),
    };
    return parBarre(v, d, f[op]);
  };
  const somme = (): Valeur => {
    let v = terme();
    while (voir()?.type === 'op' && (voir().v === '+' || voir().v === '-')) {
      const op = prendre().v;
      const d = terme();
      v = parBarre(v, d, op === '+' ? (x, y) => x + y : (x, y) => x - y);
    }
    return v;
  };
  const expression = ou;
  const terme = (): Valeur => {
    let v = facteur();
    while (voir()?.type === 'op' && (voir().v === '*' || voir().v === '/')) {
      const op = prendre().v;
      const d = facteur();
      v = parBarre(v, d, op === '*' ? (x, y) => x * y : (x, y) => (y === 0 ? NaN : x / y));
    }
    return v;
  };
  const facteur = (): Valeur => {
    const j = prendre();
    if (!j) throw new Error('Formule incomplète');
    if (j.type === 'nombre') {
      const v = Number(j.v);
      if (!Number.isFinite(v)) throw new Error(`Nombre invalide « ${j.v} »`);
      return v;
    }
    if (j.type === 'op' && j.v === '-') return parBarre(0, facteur(), (x, y) => x - y);
    if (j.type === '(') {
      const v = expression();
      attendre(')');
      return v;
    }
    if (j.type === 'nom') {
      if (voir()?.type === '(') {
        prendre();
        const args: Valeur[] = [];
        if (voir()?.type !== ')') {
          args.push(expression());
          while (voir()?.type === ',') {
            prendre();
            args.push(expression());
          }
        }
        attendre(')');
        return appel(j.v, args);
      }
      if (j.v in variables) return variables[j.v];
      if ((SERIES as readonly string[]).includes(j.v)) {
        if (j.v === 'median') return b.map((x) => (x.high + x.low) / 2);
        if (j.v === 'typical') return b.map((x) => (x.high + x.low + x.close) / 3);
        return b.map((x) => x[j.v as 'open' | 'high' | 'low' | 'close' | 'volume']);
      }
      throw new Error(`Nom inconnu « ${j.v} » (séries : ${SERIES.join(', ')})`);
    }
    throw new Error(`« ${j.v} » inattendu`);
  };
  const v = expression();
  if (k < jetons.length) throw new Error(`« ${jetons[k].v} » inattendu`);
  return v;
}
