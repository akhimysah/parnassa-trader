/**
 * MQL Parnassa : un langage d'Expert Advisor façon MQL5, simplifié, exécuté à la clôture de chaque barre.
 *
 *   // Croisement de moyennes avec filtre RSI
 *   input rapide = 10        // Période rapide
 *   input lente = 30         // Période lente
 *   input filtre = 50        // RSI minimal pour acheter
 *
 *   r = ema(close, rapide)
 *   l = ema(close, lente)
 *   if crossover(r, l) and rsi(close, 14) > filtre then close sell; buy
 *   if crossunder(r, l) then close buy; sell
 *   if position > 0 and rsi(close, 14) > 80 then close buy
 *
 * - `input nom = valeur // libellé` : paramètre de l'expert, modifiable et optimisable dans le testeur ;
 * - `nom = expression` : variable (une série, calculée sur toutes les barres) ;
 * - `if condition then action; action` : vérifiée sur la barre qui vient de se fermer ;
 * - actions : `buy`, `sell`, `close buy`, `close sell`, `close all` ;
 * - séries prêtes : open, high, low, close, volume, median, typical, hour, dayofweek (0 = lundi), position
 *   (1 en achat, -1 en vente, 0 sans position) ; fonctions : celles des formules, plus crossover, crossunder, iff ;
 *   opérateurs : + - * / < > <= >= == != and or not.
 */
import type { Bougie } from '../marche/bougies';
import type { Sens } from '../compte/moteur';
import { evaluerExpression } from '../graphique/formule';
import type { Valeurs } from '../graphique/indicateurs';

export interface EntreeScript {
  nom: string;
  defaut: number;
  libelle: string;
}

type Action = { type: 'ouvrir'; sens: Sens } | { type: 'fermer'; sens: Sens | 'tout' };

type Instruction =
  | { type: 'entree'; ligne: number; entree: EntreeScript }
  | { type: 'variable'; ligne: number; nom: string; expression: string }
  | { type: 'si'; ligne: number; condition: string; actions: Action[] };

export interface ScriptCompile {
  instructions: Instruction[];
  entrees: EntreeScript[];
}

export class ErreurScript extends Error {
  constructor(
    message: string,
    public ligne: number,
  ) {
    super(`ligne ${ligne} : ${message}`);
  }
}

const RESERVES = new Set(['input', 'if', 'then', 'and', 'or', 'not', 'buy', 'sell', 'close', 'all', 'open', 'high', 'low', 'volume', 'median', 'typical', 'hour', 'dayofweek', 'position']);
const NOM = /^[a-z_][a-z0-9_]*$/;

function action(texte: string, ligne: number): Action {
  const t = texte.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t === 'buy') return { type: 'ouvrir', sens: 'buy' };
  if (t === 'sell') return { type: 'ouvrir', sens: 'sell' };
  if (t === 'close buy') return { type: 'fermer', sens: 'buy' };
  if (t === 'close sell') return { type: 'fermer', sens: 'sell' };
  if (t === 'close all' || t === 'close') return { type: 'fermer', sens: 'tout' };
  throw new ErreurScript(`action inconnue « ${texte.trim()} » (buy, sell, close buy, close sell, close all)`, ligne);
}

const cache = new Map<string, ScriptCompile>();

/** Analyse le script ; lève une ErreurScript avec le numéro de ligne. Le résultat est mis en cache. */
export function compiler(source: string): ScriptCompile {
  const deja = cache.get(source);
  if (deja) return deja;
  const instructions: Instruction[] = [];
  const entrees: EntreeScript[] = [];
  const noms = new Set<string>();
  source.split('\n').forEach((brute, k) => {
    const ligne = k + 1;
    const commentaire = brute.indexOf('//');
    const texte = (commentaire >= 0 ? brute.slice(0, commentaire) : brute).trim();
    const note = commentaire >= 0 ? brute.slice(commentaire + 2).trim() : '';
    if (!texte) return;
    const bas = texte.toLowerCase();
    let m = /^input\s+([a-z_][a-z0-9_]*)\s*=\s*(-?[0-9.]+)$/i.exec(texte);
    if (m) {
      const nom = m[1].toLowerCase();
      const defaut = Number(m[2]);
      if (RESERVES.has(nom) || noms.has(nom)) throw new ErreurScript(`nom « ${nom} » réservé ou déjà utilisé`, ligne);
      if (['volume', 'sl', 'tp', 'suiveur', 'equilibre'].includes(nom)) throw new ErreurScript(`« ${nom} » est déjà un paramètre commun de l'expert`, ligne);
      if (!Number.isFinite(defaut)) throw new ErreurScript('valeur numérique attendue', ligne);
      noms.add(nom);
      const entree = { nom, defaut, libelle: note || nom };
      entrees.push(entree);
      instructions.push({ type: 'entree', ligne, entree });
      return;
    }
    if (bas.startsWith('input')) throw new ErreurScript('forme attendue : input nom = nombre', ligne);
    m = /^if\s+(.+?)\s+then\s+(.+)$/i.exec(texte);
    if (m) {
      instructions.push({ type: 'si', ligne, condition: m[1], actions: m[2].split(';').filter((x) => x.trim()).map((a) => action(a, ligne)) });
      return;
    }
    if (bas.startsWith('if')) throw new ErreurScript('forme attendue : if condition then action', ligne);
    m = /^([a-z_][a-z0-9_]*)\s*=(?!=)\s*(.+)$/i.exec(texte);
    if (m) {
      const nom = m[1].toLowerCase();
      if (RESERVES.has(nom) || !NOM.test(nom)) throw new ErreurScript(`nom « ${nom} » réservé`, ligne);
      if (entrees.some((e) => e.nom === nom)) throw new ErreurScript(`« ${nom} » est une entrée : elle ne peut pas être modifiée`, ligne);
      noms.add(nom);
      instructions.push({ type: 'variable', ligne, nom, expression: m[2] });
      return;
    }
    throw new ErreurScript('instruction non reconnue (input, nom = expression, ou if … then …)', ligne);
  });
  if (!instructions.some((i) => i.type === 'si')) throw new ErreurScript("aucune instruction « if … then … » : l'expert ne passerait aucun ordre", Math.max(1, source.split('\n').length));
  const r = { instructions, entrees };
  if (cache.size > 50) cache.clear();
  cache.set(source, r);
  return r;
}

export interface DecisionScript {
  fermer: Sens[];
  ouvrir: Sens | null;
  raison: string;
}

/** Exécute le script sur les barres clôturées `b` ; `p` : valeurs des entrées (sinon leur défaut). */
export function executerScript(source: string, b: Bougie[], sensActuel: Sens | null, p: Record<string, number> = {}): DecisionScript {
  const { instructions } = compiler(source);
  const i = b.length - 1;
  const variables: Record<string, Valeurs | number> = {
    hour: b.map((x) => new Date(x.time * 1000).getHours()),
    dayofweek: b.map((x) => (new Date(x.time * 1000).getDay() + 6) % 7),
    position: sensActuel === 'buy' ? 1 : sensActuel === 'sell' ? -1 : 0,
  };
  const fermer = new Set<Sens>();
  let ouvrir: Sens | null = null;
  const raisons: string[] = [];
  for (const ins of instructions) {
    try {
      if (ins.type === 'entree') variables[ins.entree.nom] = Number.isFinite(p[ins.entree.nom]) ? p[ins.entree.nom] : ins.entree.defaut;
      else if (ins.type === 'variable') variables[ins.nom] = evaluerExpression(ins.expression, b, variables);
      else {
        const v = evaluerExpression(ins.condition, b, variables);
        const vraie = typeof v === 'number' ? v !== 0 : v[i] !== null && v[i] !== 0;
        if (!vraie) continue;
        raisons.push(ins.condition.trim());
        for (const a of ins.actions) {
          if (a.type === 'fermer') for (const s of a.sens === 'tout' ? (['buy', 'sell'] as Sens[]) : [a.sens]) fermer.add(s);
          else ouvrir ??= a.sens;
        }
      }
    } catch (e) {
      throw new ErreurScript(e instanceof Error ? e.message : 'erreur de calcul', ins.ligne);
    }
  }
  return { fermer: [...fermer], ouvrir, raison: raisons.join(' ; ').slice(0, 120) };
}

/** Message d'erreur (avec la ligne) ou null : compile puis exécute à blanc sur des barres de test. */
export function verifierScript(source: string): string | null {
  try {
    const { entrees } = compiler(source);
    const essai: Bougie[] = Array.from({ length: 300 }, (_, k) => {
      const c = 100 + 10 * Math.sin(k / 9) + k / 20;
      return { time: 1_700_000_000 + k * 3600, open: c - 0.3, high: c + 1, low: c - 1, close: c, volume: 100 };
    });
    executerScript(source, essai, null, Object.fromEntries(entrees.map((e) => [e.nom, e.defaut])));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'script invalide';
  }
}

export const EXEMPLE_SCRIPT = `// Croisement de moyennes avec filtre RSI — MQL Parnassa
input rapide = 10        // Période de la moyenne rapide
input lente = 30         // Période de la moyenne lente
input filtre = 50        // RSI minimal pour acheter

r = ema(close, rapide)
l = ema(close, lente)
force = rsi(close, 14)

if crossover(r, l) and force > filtre then close sell; buy
if crossunder(r, l) and force < 100 - filtre then close buy; sell
// Sortie anticipée en surachat / survente
if position > 0 and force > 80 then close buy
if position < 0 and force < 20 then close sell
`;
