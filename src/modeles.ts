import { identifiant, type EtatTerminal, type Graphique } from './etat';

/**
 * Modèles et profils, comme dans MT5. Un modèle garde la présentation d'un graphique (type, couleurs, indicateurs,
 * options, expert) pour l'appliquer à un autre ; un profil garde l'ensemble des graphiques ouverts et leur disposition.
 */
export interface ModeleGraphique {
  nom: string;
  reglages: Partial<Graphique>;
}

export interface Profil {
  nom: string;
  graphiques: Graphique[];
  graphiqueActif: string;
  disposition: EtatTerminal['disposition'];
}

/** Ce qu'un modèle emporte (ni le symbole, ni la période, ni les objets tracés à des prix précis). */
const CHAMPS = ['type', 'indicateurs', 'grille', 'ligneAsk', 'niveauxTrading', 'historiqueTrading', 'defilement', 'decalage', 'unClic', 'schema', 'expert'] as const;

export function modeleDepuis(nom: string, g: Graphique): ModeleGraphique {
  return { nom, reglages: Object.fromEntries(CHAMPS.map((k) => [k, structuredClone(g[k])])) as Partial<Graphique> };
}

/** Réglages d'un modèle prêts à poser sur un graphique : indicateurs et expert reçoivent leurs propres identifiants. */
export function reglagesModele(m: ModeleGraphique): Partial<Graphique> {
  const r = structuredClone(m.reglages);
  if (r.indicateurs) r.indicateurs = r.indicateurs.map((i) => ({ ...i, id: identifiant() }));
  if (r.expert) r.expert = { ...r.expert, magic: 100000 + Math.floor(Math.random() * 900000) };
  return r;
}

/** Nom saisi par l'utilisateur, nettoyé ; null si annulé ou vide. */
export function demanderNom(question: string, defaut: string): string | null {
  const nom = window.prompt(question, defaut)?.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  return nom ? nom : null;
}

export function enregistrerModele(e: EtatTerminal, g: Graphique, nom: string): EtatTerminal {
  const m = modeleDepuis(nom, g);
  return { ...e, modeles: [...e.modeles.filter((x) => x.nom !== nom), m].sort((a, b) => a.nom.localeCompare(b.nom)) };
}

export function enregistrerProfil(e: EtatTerminal, nom: string): EtatTerminal {
  const p: Profil = { nom, graphiques: structuredClone(e.graphiques), graphiqueActif: e.graphiqueActif, disposition: e.disposition };
  return { ...e, profils: [...e.profils.filter((x) => x.nom !== nom), p].sort((a, b) => a.nom.localeCompare(b.nom)), profilActif: nom };
}

export function chargerProfil(e: EtatTerminal, nom: string): EtatTerminal {
  const p = e.profils.find((x) => x.nom === nom);
  if (!p || !p.graphiques.length) return e;
  const graphiques = structuredClone(p.graphiques);
  return { ...e, graphiques, graphiqueActif: graphiques.some((g) => g.id === p.graphiqueActif) ? p.graphiqueActif : graphiques[0].id, disposition: p.disposition, profilActif: nom };
}
