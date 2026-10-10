import type { Compte } from './compte/moteur';
import { nouveauCompte } from './compte/moteur';
import type { Periode } from './marche/bougies';
import type { Indicateur } from './graphique/indicateurs';
import type { Expert } from './algo/experts';
import { OBSERVATION_DEFAUT, symbole } from './marche/symboles';

export type TypeGraphique = 'barres' | 'bougies' | 'ligne' | 'heikin';
export type Schema = 'vert-noir' | 'noir-blanc' | 'couleurs';

export interface ObjetGraphique {
  id: string;
  type: 'horizontale' | 'tendance' | 'fibo' | 'verticale' | 'rectangle' | 'canal' | 'texte';
  /** Points d'ancrage (temps en secondes, prix). La ligne horizontale n'utilise que le prix du premier. */
  points: { t: number; prix: number }[];
  couleur: string;
  /** Texte de l'objet « texte ». */
  texte?: string;
}

export interface Graphique {
  id: string;
  symbole: string;
  periode: Periode;
  type: TypeGraphique;
  indicateurs: Indicateur[];
  objets: ObjetGraphique[];
  grille: boolean;
  ligneAsk: boolean;
  niveauxTrading: boolean;
  historiqueTrading: boolean;
  defilement: boolean;
  decalage: boolean;
  unClic: boolean;
  /** Volume du panneau de trading en un clic de ce graphique (mémorisé). */
  volumeUnClic?: number;
  schema: Schema;
  /** Expert Advisor attaché au graphique. */
  expert: Expert | null;
  /** Annonces du calendrier économique sur le graphique (affichées si absent). */
  calendrier?: boolean;
  /** Séparateurs de périodes (jour, semaine, mois ou année selon la période). */
  separateurs?: boolean;
}

export interface Alerte {
  id: string;
  symbole: string;
  /** Prix au-dessus / en dessous, ou heure atteinte (valeur = horodatage en ms). */
  condition: 'bid>' | 'bid<' | 'ask>' | 'ask<' | 'heure=';
  valeur: number;
  active: boolean;
  commentaire: string;
  declencheeLe?: number;
  /** Nombre de déclenchements avant désactivation (1 par défaut) et pause entre deux, en secondes. */
  max?: number;
  pause?: number;
  declenchements?: number;
  /** Désactivée passé cette date (ms). */
  expiration?: number;
}

export interface EtatTerminal {
  comptes: Compte[];
  actif: number;
  observation: string[];
  colonnes: { spread: boolean; haut: boolean; bas: boolean; heure: boolean; variation: boolean };
  graphiques: Graphique[];
  graphiqueActif: string;
  disposition: 'onglets' | 'mosaique';
  panneaux: { observation: boolean; navigateur: boolean; boite: boolean; barreOutils: boolean; barreEtat: boolean; testeur: boolean; donnees: boolean };
  hauteurBoite: number;
  /** Trading en un clic : accepté une fois (avertissement MT5). */
  unClicAccepte: boolean;
  volumeDefaut: number;
  son: boolean;
  theme: 'clair' | 'sombre';
  /** Thème automatique : suit le réglage clair / sombre du système (theme est alors mis à jour tout seul). */
  themeAuto: boolean;
  /** Empêche la mise en veille de l'écran tant que l'application est affichée (propre à l'appareil). */
  ecranAllume: boolean;
  alertes: Alerte[];
  /** Algo Trading : autorise les Expert Advisors à trader. */
  algo: boolean;
  /** Notifications du système pour les exécutions, SL/TP, stop-out et alertes (application en arrière-plan). */
  notifications: boolean;
  /** Mobile : profit des positions affiché en points plutôt qu'en devise de dépôt. */
  profitEnPoints: boolean;
  /** Mobile : cotations en mode avancé (variation, heure, spread, plus haut / bas) ou simple. */
  mobileAvance: boolean;
  /** Messages de la boîte aux lettres déjà lus. */
  lus: string[];
  /** Modèles de graphique enregistrés, et celui appliqué aux nouveaux graphiques. */
  modeles: import('./modeles').ModeleGraphique[];
  modeleDefaut: string | null;
  /** Profils (ensembles de graphiques) enregistrés, et le dernier chargé ou enregistré. */
  profils: import('./modeles').Profil[];
  profilActif: string | null;
  /** Experts créés avec l'assistant. */
  expertsPerso: import('./algo/assistant').ExpertPerso[];
  /** Ensembles de symboles de l'Observation du marché (comme les « sets » de MT5). */
  ensembles: { nom: string; symboles: string[] }[];
}

export function identifiant(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nouveauGraphique(sym: string, periode: Periode = 'H1', modele?: Partial<Graphique>): Graphique {
  return {
    id: identifiant(),
    symbole: sym,
    periode,
    type: 'bougies',
    indicateurs: [],
    objets: [],
    grille: true,
    ligneAsk: true,
    niveauxTrading: true,
    historiqueTrading: true,
    defilement: true,
    decalage: true,
    unClic: true,
    schema: 'couleurs',
    expert: null,
    ...modele,
  };
}

function etatInitial(): EtatTerminal {
  const compte = nouveauCompte('Compte démo', 10000, 100);
  const graphiques = [nouveauGraphique('EURUSD', 'H1'), nouveauGraphique('XAUUSD', 'M15'), nouveauGraphique('BTCUSD', 'H1'), nouveauGraphique('US500', 'H4')];
  return {
    comptes: [compte],
    actif: compte.login,
    observation: OBSERVATION_DEFAUT,
    colonnes: { spread: false, haut: false, bas: false, heure: false, variation: true },
    graphiques,
    graphiqueActif: graphiques[0].id,
    disposition: 'onglets',
    panneaux: { observation: true, navigateur: true, boite: true, barreOutils: true, barreEtat: true, testeur: false, donnees: false },
    hauteurBoite: 230,
    unClicAccepte: false,
    volumeDefaut: 0.1,
    son: true,
    theme: 'clair',
    themeAuto: false,
    ecranAllume: false,
    alertes: [],
    algo: false,
    mobileAvance: true,
    profitEnPoints: false,
    notifications: false,
    lus: [],
    modeles: [],
    modeleDefaut: null,
    profils: [],
    profilActif: null,
    expertsPerso: [],
    ensembles: [],
  };
}

const CLE = 'parnassa-trader:v1';

/** Complète un état lu (stockage local ou compte Parnassa) avec les valeurs par défaut et écarte l'invalide. */
export function fusionnerEtat(lu: Partial<EtatTerminal>): EtatTerminal {
  const base = etatInitial();
  const etat: EtatTerminal = { ...base, ...lu, colonnes: { ...base.colonnes, ...lu.colonnes }, panneaux: { ...base.panneaux, ...lu.panneaux } };
  etat.observation = (etat.observation ?? []).filter((n) => symbole(n));
  etat.graphiques = (etat.graphiques ?? []).filter((g) => symbole(g.symbole)).map((g) => ({ ...nouveauGraphique(g.symbole), ...g }));
  if (etat.graphiques.length === 0) etat.graphiques = base.graphiques;
  if (!etat.graphiques.some((g) => g.id === etat.graphiqueActif)) etat.graphiqueActif = etat.graphiques[0].id;
  if (!etat.comptes?.length) etat.comptes = base.comptes;
  if (!etat.comptes.some((c) => c.login === etat.actif)) etat.actif = etat.comptes[0].login;
  return etat;
}

export function chargerEtat(): EtatTerminal {
  try {
    const brut = localStorage.getItem(CLE);
    return brut ? fusionnerEtat(JSON.parse(brut) as Partial<EtatTerminal>) : etatInitial();
  } catch {
    return etatInitial();
  }
}

export function sauverEtat(e: EtatTerminal) {
  try {
    localStorage.setItem(CLE, JSON.stringify(e));
  } catch {
    // stockage plein ou indisponible (navigation privée) : l'état reste en mémoire
  }
}
