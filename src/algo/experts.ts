/**
 * Expert Advisors intégrés : de petits robots qui décident à la clôture de chaque barre, comme les EA de MT5
 * attachés à un graphique. Ils ne tournent que tant que le terminal est ouvert et que l'Algo Trading est actif.
 */
import type { Bougie } from '../marche/bougies';
import { calculer, moyenne } from '../graphique/indicateurs';
import type { Sens } from '../compte/moteur';
import { decrireExpert, deciderPerso, type ExpertPerso } from './assistant';

/** Experts intégrés, ou créés avec l'assistant (« perso:<id> »). */
export type TypeExpert = 'croisement-ma' | 'rsi' | 'bollinger' | 'cassure' | 'macd' | 'stochastique' | 'sar' | 'alligator' | `perso:${string}`;

export interface Expert {
  type: TypeExpert;
  p: Record<string, number>;
  /** Numéro magique : identifie les positions ouvertes par cet expert. */
  magic: number;
}

export interface DefinitionExpert {
  type: TypeExpert;
  nom: string;
  description: string;
  defaut: Record<string, number>;
  libelles: Record<string, string>;
}

const COMMUNS = { volume: 0.1, sl: 0, tp: 0, suiveur: 0, equilibre: 0 };
const LIBELLES_COMMUNS = {
  volume: 'Volume (lots)',
  sl: 'Stop Loss (points, 0 = aucun)',
  tp: 'Take Profit (points, 0 = aucun)',
  suiveur: 'Stop suiveur (points, 0 = aucun)',
  equilibre: 'Break-even après (points, 0 = aucun)',
};

export const EXPERTS: DefinitionExpert[] = [
  {
    type: 'croisement-ma',
    nom: 'Moving Average Cross',
    description: "Achète quand la moyenne rapide croise au-dessus de la lente, vend au croisement inverse. Toujours en position, retournée à chaque signal.",
    defaut: { rapide: 10, lente: 30, ...COMMUNS },
    libelles: { rapide: 'Période rapide (EMA)', lente: 'Période lente (EMA)', ...LIBELLES_COMMUNS },
  },
  {
    type: 'rsi',
    nom: 'RSI Reversal',
    description: 'Achète quand le RSI ressort de la zone de survente, vend quand il ressort de la zone de surachat. Le signal inverse ferme la position.',
    defaut: { periode: 14, bas: 30, haut: 70, ...COMMUNS },
    libelles: { periode: 'Période du RSI', bas: 'Niveau de survente', haut: 'Niveau de surachat', ...LIBELLES_COMMUNS },
  },
  {
    type: 'bollinger',
    nom: 'Bollinger Rebound',
    description: 'Achète une clôture sous la bande basse, vend une clôture au-dessus de la bande haute ; sort au retour sur la moyenne.',
    defaut: { periode: 20, ecarts: 2, ...COMMUNS },
    libelles: { periode: 'Période', ecarts: 'Écarts types', ...LIBELLES_COMMUNS },
  },
  {
    type: 'cassure',
    nom: 'Channel Breakout',
    description: 'Achète la cassure du plus haut des N dernières barres, vend la cassure du plus bas (canal de Donchian), position retournée à chaque cassure.',
    defaut: { periode: 20, ...COMMUNS },
    libelles: { periode: 'Barres du canal', ...LIBELLES_COMMUNS },
  },
  {
    type: 'macd',
    nom: 'MACD Sample',
    description: "L'exemple classique de MT5 : achète quand le MACD croise son signal au-dessus en zone négative et que la tendance (EMA) monte ; vend à l'inverse. Sortie au croisement contraire.",
    defaut: { rapide: 12, lente: 26, signal: 9, tendance: 26, ...COMMUNS },
    libelles: { rapide: 'EMA rapide', lente: 'EMA lente', signal: 'SMA du signal', tendance: 'EMA de tendance', ...LIBELLES_COMMUNS },
  },
  {
    type: 'stochastique',
    nom: 'Stochastic Cross',
    description: 'Achète quand %K croise %D au-dessus en zone de survente, vend quand %K croise %D en dessous en zone de surachat.',
    defaut: { k: 5, d: 3, ralenti: 3, bas: 20, haut: 80, ...COMMUNS },
    libelles: { k: 'Période %K', d: 'Période %D', ralenti: 'Ralentissement', bas: 'Survente', haut: 'Surachat', ...LIBELLES_COMMUNS },
  },
  {
    type: 'sar',
    nom: 'Parabolic SAR Reversal',
    description: 'Toujours en position : achète quand le prix passe au-dessus du SAR, vend quand il passe en dessous.',
    defaut: { pas: 0.02, max: 0.2, ...COMMUNS },
    libelles: { pas: 'Pas', max: 'Maximum', ...LIBELLES_COMMUNS },
  },
  {
    type: 'alligator',
    nom: 'Alligator Trend',
    description: "Bill Williams : achète quand les lèvres, les dents et la mâchoire s'ouvrent vers le haut et que le prix est au-dessus, vend à l'inverse ; sort quand les lèvres recroisent les dents.",
    defaut: { machoire: 13, dents: 8, levres: 5, ...COMMUNS },
    libelles: { machoire: 'Mâchoire', dents: 'Dents', levres: 'Lèvres', ...LIBELLES_COMMUNS },
  },
];

// Experts de l'assistant, tenus à jour par le terminal (état synchronisé) et lus comme les experts intégrés.
let persos: ExpertPerso[] = [];
export function definirExpertsPerso(liste: ExpertPerso[]) {
  persos = liste;
}
export function expertPerso(t: TypeExpert): ExpertPerso | undefined {
  return t.startsWith('perso:') ? persos.find((e) => `perso:${e.id}` === t) : undefined;
}

/** Experts intégrés puis ceux de l'assistant. */
export function tousExperts(): DefinitionExpert[] {
  return [...EXPERTS, ...persos.map((e) => definitionExpert(`perso:${e.id}`))];
}

export function definitionExpert(t: TypeExpert): DefinitionExpert {
  if (t.startsWith('perso:')) {
    const e = expertPerso(t);
    return { type: t, nom: e ? e.nom : 'Expert supprimé', description: e ? decrireExpert(e) : "Cet expert de l'assistant a été supprimé : il ne trade plus.", defaut: { ...COMMUNS }, libelles: { ...LIBELLES_COMMUNS } };
  }
  return EXPERTS.find((e) => e.type === t) ?? EXPERTS[0];
}

export interface Decision {
  /** Positions de l'expert à fermer (par sens). */
  fermer: Sens[];
  /** Position à ouvrir (si l'expert n'en a pas déjà une dans ce sens). */
  ouvrir: Sens | null;
  raison: string;
}

const RIEN: Decision = { fermer: [], ouvrir: null, raison: '' };

/**
 * Décision sur les barres clôturées `b` (la dernière est la barre qui vient de se fermer).
 * `sensActuel` : sens de la position de l'expert sur ce symbole (null s'il n'en a pas).
 */
export function decider(e: Expert, b: Bougie[], sensActuel: Sens | null): Decision {
  const n = b.length;
  if (n < 3) return RIEN;
  if (e.type.startsWith('perso:')) {
    const perso = expertPerso(e.type);
    return perso ? deciderPerso(perso, b, sensActuel) : RIEN;
  }
  const p = e.p;
  const c = b.map((x) => x.close);
  const i = n - 1;
  switch (e.type) {
    case 'croisement-ma': {
      const r = moyenne(c, p.rapide, 'ema');
      const l = moyenne(c, p.lente, 'ema');
      if (r[i] === null || l[i] === null || r[i - 1] === null || l[i - 1] === null) return RIEN;
      if (r[i - 1]! <= l[i - 1]! && r[i]! > l[i]!) return { fermer: ['sell'], ouvrir: 'buy', raison: `EMA(${p.rapide}) croise au-dessus de EMA(${p.lente})` };
      if (r[i - 1]! >= l[i - 1]! && r[i]! < l[i]!) return { fermer: ['buy'], ouvrir: 'sell', raison: `EMA(${p.rapide}) croise sous EMA(${p.lente})` };
      return RIEN;
    }
    case 'rsi': {
      const rsi = calculer({ id: '', type: 'rsi', p: { periode: p.periode }, couleur: '' }, b).traces[0].valeurs;
      const a = rsi[i - 1];
      const v = rsi[i];
      if (a === null || v === null) return RIEN;
      if (a < p.bas && v >= p.bas) return { fermer: ['sell'], ouvrir: 'buy', raison: `RSI ressort de la survente (${v.toFixed(1)})` };
      if (a > p.haut && v <= p.haut) return { fermer: ['buy'], ouvrir: 'sell', raison: `RSI ressort du surachat (${v.toFixed(1)})` };
      return RIEN;
    }
    case 'bollinger': {
      const [milieu, haut, bas] = calculer({ id: '', type: 'bb', p: { periode: p.periode, ecarts: p.ecarts }, couleur: '' }, b).traces.map((t) => t.valeurs);
      const m = milieu[i];
      const h = haut[i];
      const l = bas[i];
      if (m === null || h === null || l === null) return RIEN;
      if (sensActuel === 'buy' && c[i]! >= m) return { fermer: ['buy'], ouvrir: null, raison: 'retour sur la moyenne' };
      if (sensActuel === 'sell' && c[i]! <= m) return { fermer: ['sell'], ouvrir: null, raison: 'retour sur la moyenne' };
      if (c[i]! < l) return { fermer: ['sell'], ouvrir: 'buy', raison: 'clôture sous la bande basse' };
      if (c[i]! > h) return { fermer: ['buy'], ouvrir: 'sell', raison: 'clôture au-dessus de la bande haute' };
      return RIEN;
    }
    case 'cassure': {
      if (n < p.periode + 1) return RIEN;
      const canal = b.slice(n - 1 - p.periode, n - 1);
      const plusHaut = Math.max(...canal.map((x) => x.high));
      const plusBas = Math.min(...canal.map((x) => x.low));
      if (c[i]! > plusHaut) return { fermer: ['sell'], ouvrir: 'buy', raison: `cassure du plus haut ${p.periode} barres` };
      if (c[i]! < plusBas) return { fermer: ['buy'], ouvrir: 'sell', raison: `cassure du plus bas ${p.periode} barres` };
      return RIEN;
    }
    case 'macd': {
      const [macd, signal] = calculer({ id: '', type: 'macd', p: { rapide: p.rapide, lente: p.lente, signal: p.signal }, couleur: '' }, b).traces.map((t) => t.valeurs);
      const tendance = moyenne(c, p.tendance, 'ema');
      const [m0, m1, s0, s1, t0, t1] = [macd[i - 1], macd[i], signal[i - 1], signal[i], tendance[i - 1], tendance[i]];
      if (m0 === null || m1 === null || s0 === null || s1 === null || t0 === null || t1 === null) return RIEN;
      if (sensActuel === 'buy' && m0 >= s0 && m1 < s1) return { fermer: ['buy'], ouvrir: null, raison: 'MACD repasse sous son signal' };
      if (sensActuel === 'sell' && m0 <= s0 && m1 > s1) return { fermer: ['sell'], ouvrir: null, raison: 'MACD repasse au-dessus de son signal' };
      if (m1 < 0 && m0 <= s0 && m1 > s1 && t1 > t0) return { fermer: ['sell'], ouvrir: 'buy', raison: 'MACD croise son signal au-dessus sous zéro, tendance haussière' };
      if (m1 > 0 && m0 >= s0 && m1 < s1 && t1 < t0) return { fermer: ['buy'], ouvrir: 'sell', raison: 'MACD croise son signal en dessous au-dessus de zéro, tendance baissière' };
      return RIEN;
    }
    case 'stochastique': {
      const [k, d] = calculer({ id: '', type: 'stoch', p: { k: p.k, d: p.d, ralenti: p.ralenti }, couleur: '' }, b).traces.map((t) => t.valeurs);
      const [k0, k1, d0, d1] = [k[i - 1], k[i], d[i - 1], d[i]];
      if (k0 === null || k1 === null || d0 === null || d1 === null) return RIEN;
      if (k0 <= d0 && k1 > d1 && Math.min(k0, k1) < p.bas) return { fermer: ['sell'], ouvrir: 'buy', raison: `%K croise %D au-dessus en survente (${k1.toFixed(1)})` };
      if (k0 >= d0 && k1 < d1 && Math.max(k0, k1) > p.haut) return { fermer: ['buy'], ouvrir: 'sell', raison: `%K croise %D en dessous en surachat (${k1.toFixed(1)})` };
      return RIEN;
    }
    case 'sar': {
      const sar = calculer({ id: '', type: 'sar', p: { pas: p.pas, max: p.max }, couleur: '' }, b).traces[0]?.valeurs ?? [];
      const [a0, a1] = [sar[i - 1], sar[i]];
      if (a0 === null || a1 === null || a0 === undefined || a1 === undefined) return RIEN;
      if (c[i - 1]! <= a0 && c[i]! > a1) return { fermer: ['sell'], ouvrir: 'buy', raison: 'le prix passe au-dessus du SAR' };
      if (c[i - 1]! >= a0 && c[i]! < a1) return { fermer: ['buy'], ouvrir: 'sell', raison: 'le prix passe sous le SAR' };
      return RIEN;
    }
    case 'alligator': {
      const [m, dn, l] = calculer({ id: '', type: 'alligator', p: { machoire: p.machoire, dents: p.dents, levres: p.levres }, couleur: '' }, b).traces.map((t) => t.valeurs);
      const [mi, di, li] = [m[i], dn[i], l[i]];
      if (mi === null || di === null || li === null) return RIEN;
      if (sensActuel === 'buy' && li < di) return { fermer: ['buy'], ouvrir: null, raison: "les lèvres repassent sous les dents : l'alligator se referme" };
      if (sensActuel === 'sell' && li > di) return { fermer: ['sell'], ouvrir: null, raison: "les lèvres repassent au-dessus des dents : l'alligator se referme" };
      if (li > di && di > mi && c[i]! > li && sensActuel !== 'buy') return { fermer: ['sell'], ouvrir: 'buy', raison: "l'alligator s'ouvre vers le haut" };
      if (li < di && di < mi && c[i]! < li && sensActuel !== 'sell') return { fermer: ['buy'], ouvrir: 'sell', raison: "l'alligator s'ouvre vers le bas" };
      return RIEN;
    }
    default:
      return RIEN;
  }
}
