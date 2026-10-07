import type { Compte } from './compte/moteur';
import { nouveauCompte } from './compte/moteur';
import type { Periode } from './marche/bougies';
import type { Indicateur } from './graphique/indicateurs';
import type { Expert } from './algo/experts';
import { OBSERVATION_DEFAUT, symbole } from './marche/symboles';

export type TypeGraphique = 'barres' | 'bougies' | 'ligne';
export type Schema = 'vert-noir' | 'noir-blanc' | 'couleurs';

export interface ObjetGraphique {
  id: string;
  type: 'horizontale' | 'tendance' | 'fibo';
  /** Points d'ancrage (temps en secondes, prix). La ligne horizontale n'utilise que le prix du premier. */
  points: { t: number; prix: number }[];
  couleur: string;
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
  schema: Schema;
  /** Expert Advisor attaché au graphique. */
  expert: Expert | null;
}

export interface Alerte {
  id: string;
  symbole: string;
  condition: 'bid>' | 'bid<' | 'ask>' | 'ask<';
  valeur: number;
  active: boolean;
  commentaire: string;
  declencheeLe?: number;
}

export interface EtatTerminal {
  comptes: Compte[];
  actif: number;
  observation: string[];
  colonnes: { spread: boolean; haut: boolean; bas: boolean; heure: boolean; variation: boolean };
  graphiques: Graphique[];
  graphiqueActif: string;
  disposition: 'onglets' | 'mosaique';
  panneaux: { observation: boolean; navigateur: boolean; boite: boolean; barreOutils: boolean; barreEtat: boolean; testeur: boolean };
  hauteurBoite: number;
  /** Trading en un clic : accepté une fois (avertissement MT5). */
  unClicAccepte: boolean;
  volumeDefaut: number;
  son: boolean;
  theme: 'clair' | 'sombre';
  alertes: Alerte[];
  /** Algo Trading : autorise les Expert Advisors à trader. */
  algo: boolean;
  /** Messages de la boîte aux lettres déjà lus. */
  lus: string[];
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
    panneaux: { observation: true, navigateur: true, boite: true, barreOutils: true, barreEtat: true, testeur: false },
    hauteurBoite: 230,
    unClicAccepte: false,
    volumeDefaut: 0.1,
    son: true,
    theme: 'clair',
    alertes: [],
    algo: false,
    lus: [],
  };
}

const CLE = 'parnassa-trader:v1';

export function chargerEtat(): EtatTerminal {
  const base = etatInitial();
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return base;
    const lu = JSON.parse(brut) as Partial<EtatTerminal>;
    const etat: EtatTerminal = { ...base, ...lu, colonnes: { ...base.colonnes, ...lu.colonnes }, panneaux: { ...base.panneaux, ...lu.panneaux } };
    etat.observation = etat.observation.filter((n) => symbole(n));
    etat.graphiques = etat.graphiques.filter((g) => symbole(g.symbole)).map((g) => ({ ...nouveauGraphique(g.symbole), ...g }));
    if (etat.graphiques.length === 0) etat.graphiques = base.graphiques;
    if (!etat.graphiques.some((g) => g.id === etat.graphiqueActif)) etat.graphiqueActif = etat.graphiques[0].id;
    if (etat.comptes.length === 0) etat.comptes = base.comptes;
    if (!etat.comptes.some((c) => c.login === etat.actif)) etat.actif = etat.comptes[0].login;
    return etat;
  } catch {
    return base;
  }
}

export function sauverEtat(e: EtatTerminal) {
  try {
    localStorage.setItem(CLE, JSON.stringify(e));
  } catch {
    // stockage plein ou indisponible (navigation privée) : l'état reste en mémoire
  }
}
