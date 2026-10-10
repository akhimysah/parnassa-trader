/**
 * Assistant de création d'experts (comme l'assistant MQL5 de MT5, sans code) : l'utilisateur assemble des conditions
 * « A croise au-dessus de B », « A > B »… sur les prix, les indicateurs et des valeurs fixes, pour l'achat, la vente
 * et les sorties. Toutes les conditions d'un bloc doivent être vraies à la clôture de la barre.
 */
import type { Bougie } from '../marche/bougies';
import type { Sens } from '../compte/moteur';
import { calculer, definition, nomCourt, type MethodeMA, type TypeIndicateur, type Valeurs } from '../graphique/indicateurs';
import { calculerFormule } from '../graphique/formule';

export type ChampPrix = 'close' | 'open' | 'high' | 'low';
export type Operande =
  | { type: 'prix'; champ: ChampPrix }
  | { type: 'indicateur'; indicateur: TypeIndicateur; p: Record<string, number>; trace: number; methode?: MethodeMA }
  | { type: 'valeur'; valeur: number }
  /** Formule personnalisée (première courbe), comme l'indicateur « Formule personnalisée ». */
  | { type: 'formule'; formule: string };
export type Operateur = 'croise-dessus' | 'croise-dessous' | 'superieur' | 'inferieur';

export interface Condition {
  a: Operande;
  op: Operateur;
  b: Operande;
}

export interface ExpertPerso {
  id: string;
  nom: string;
  achat: Condition[];
  vente: Condition[];
  sortieAchat: Condition[];
  sortieVente: Condition[];
  /** Filtres d'entrée : sens autorisés, heures (heure locale, début inclus, fin exclue) et jours (0 = lundi). */
  sens?: 'deux' | 'achat' | 'vente';
  heures?: [number, number];
  jours?: number[];
}

export const CHAMPS_PRIX: Record<ChampPrix, string> = { close: 'Clôture', open: 'Ouverture', high: 'Plus haut', low: 'Plus bas' };
export const OPERATEURS: Record<Operateur, string> = { 'croise-dessus': 'croise au-dessus de', 'croise-dessous': 'croise en dessous de', superieur: 'est au-dessus de', inferieur: 'est en dessous de' };

/** Noms des courbes d'un indicateur (pour choisir la ligne : MACD ou Signal, bandes…). */
export function tracesIndicateur(t: TypeIndicateur, p: Record<string, number>): string[] {
  try {
    const noms = calculer({ id: '', type: t, p, couleur: '' }, []).traces.map((x) => x.nom);
    return noms.length ? noms : [definition(t).nom];
  } catch {
    return [definition(t).nom];
  }
}

export function libelleOperande(o: Operande): string {
  if (o.type === 'prix') return CHAMPS_PRIX[o.champ];
  if (o.type === 'valeur') return String(o.valeur);
  if (o.type === 'formule') return `[${o.formule}]`;
  const nom = nomCourt({ id: '', type: o.indicateur, p: o.p, couleur: '', methode: o.methode });
  const traces = tracesIndicateur(o.indicateur, o.p);
  return traces.length > 1 ? `${nom} ${traces[o.trace] ?? ''}`.trim() : nom;
}

export function libelleCondition(c: Condition): string {
  return `${libelleOperande(c.a)} ${OPERATEURS[c.op]} ${libelleOperande(c.b)}`;
}

/** Description lisible de l'expert, affichée comme celle des experts intégrés. */
export function decrireExpert(e: ExpertPerso): string {
  const bloc = (titre: string, cs: Condition[]) => (cs.length ? `${titre} : ${cs.map(libelleCondition).join(' et ')}.` : '');
  return [bloc('Achat', e.achat), bloc('Vente', e.vente), bloc('Sortie des achats', e.sortieAchat), bloc('Sortie des ventes', e.sortieVente)].filter(Boolean).join(' ') || 'Aucune condition.';
}

export function nouvelExpertPerso(id: string): ExpertPerso {
  const ma = (periode: number): Operande => ({ type: 'indicateur', indicateur: 'ma', p: { periode, decalage: 0 }, trace: 0 });
  return {
    id,
    nom: 'Mon expert',
    achat: [{ a: ma(10), op: 'croise-dessus', b: ma(30) }],
    vente: [{ a: ma(10), op: 'croise-dessous', b: ma(30) }],
    sortieAchat: [],
    sortieVente: [],
  };
}

/** Évaluateur de conditions sur les barres `b` (la dernière est la barre qui vient de se fermer). */
export function evaluateur(b: Bougie[]): (c: Condition) => boolean {
  const n = b.length;
  const cache = new Map<string, Valeurs>();
  const serie = (o: Operande): Valeurs | number => {
    if (o.type === 'valeur') return o.valeur;
    if (o.type === 'prix') return b.map((x) => x[o.champ]);
    if (o.type === 'formule') {
      const cleF = `formule|${o.formule}`;
      let f = cache.get(cleF);
      if (!f) {
        try {
          f = calculerFormule(o.formule, b)[0] ?? [];
        } catch {
          f = [];
        }
        cache.set(cleF, f);
      }
      return f;
    }
    const cle = `${o.indicateur}|${JSON.stringify(o.p)}|${o.trace}|${o.methode ?? ''}`;
    let v = cache.get(cle);
    if (!v) {
      v = calculer({ id: '', type: o.indicateur, p: o.p, couleur: '', methode: o.methode }, b).traces[o.trace]?.valeurs ?? [];
      cache.set(cle, v);
    }
    return v;
  };
  const a = (s: Valeurs | number, i: number) => (typeof s === 'number' ? s : (s[i] ?? null));
  return (c: Condition): boolean => {
    if (n < 3) return false;
    const sa = serie(c.a);
    const sb = serie(c.b);
    const i = n - 1;
    const a1 = a(sa, i);
    const b1 = a(sb, i);
    if (a1 === null || b1 === null) return false;
    if (c.op === 'superieur') return a1 > b1;
    if (c.op === 'inferieur') return a1 < b1;
    const a0 = a(sa, i - 1);
    const b0 = a(sb, i - 1);
    if (a0 === null || b0 === null) return false;
    return c.op === 'croise-dessus' ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1;
  };
}

/** Décision à la clôture de la dernière barre de `b`, comme `decider` pour les experts intégrés. */
export function deciderPerso(e: ExpertPerso, b: Bougie[], sensActuel: Sens | null): { fermer: Sens[]; ouvrir: Sens | null; raison: string } {
  const rien = { fermer: [] as Sens[], ouvrir: null, raison: '' };
  if (b.length < 3) return rien;
  const vraie = evaluateur(b);
  const tout = (cs: Condition[]) => cs.length > 0 && cs.every(vraie);
  // Filtres : en dehors des heures ou jours choisis, l'expert ne fait que gérer ses sorties.
  const d = new Date(b[b.length - 1].time * 1000);
  const heure = d.getHours();
  const jour = (d.getDay() + 6) % 7;
  const [h1, h2] = e.heures ?? [0, 24];
  const dansHeures = h1 <= h2 ? heure >= h1 && heure < h2 : heure >= h1 || heure < h2;
  const ouvert = dansHeures && (!e.jours?.length || e.jours.includes(jour));
  const achatsPermis = ouvert && e.sens !== 'vente';
  const ventesPermises = ouvert && e.sens !== 'achat';
  if (!achatsPermis && tout(e.achat) && sensActuel === 'sell') return { fermer: ['sell'], ouvrir: null, raison: e.achat.map(libelleCondition).join(' et ') };
  if (!ventesPermises && tout(e.vente) && sensActuel === 'buy') return { fermer: ['buy'], ouvrir: null, raison: e.vente.map(libelleCondition).join(' et ') };
  if (achatsPermis && tout(e.achat)) return { fermer: ['sell'], ouvrir: 'buy', raison: e.achat.map(libelleCondition).join(' et ') };
  if (ventesPermises && tout(e.vente)) return { fermer: ['buy'], ouvrir: 'sell', raison: e.vente.map(libelleCondition).join(' et ') };
  if (sensActuel === 'buy' && tout(e.sortieAchat)) return { fermer: ['buy'], ouvrir: null, raison: `sortie : ${e.sortieAchat.map(libelleCondition).join(' et ')}` };
  if (sensActuel === 'sell' && tout(e.sortieVente)) return { fermer: ['sell'], ouvrir: null, raison: `sortie : ${e.sortieVente.map(libelleCondition).join(' et ')}` };
  return rien;
}
