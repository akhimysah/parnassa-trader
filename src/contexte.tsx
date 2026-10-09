import { createContext, useContext } from 'react';
import type { Compte, Resultat, Sens, TypeEnAttente } from './compte/moteur';
import type { Cotation } from './marche/cotations';
import type { EtatTerminal, Graphique } from './etat';
import type { Periode } from './marche/bougies';
import type { TypeIndicateur } from './graphique/indicateurs';
import type { Synchro } from './synchro';
import type { Acces, ComptesEnLigne } from './compte/enLigne';

export type Dialogue =
  | { type: 'ordre'; symbole?: string; sens?: Sens; attente?: TypeEnAttente; prix?: number; volume?: number }
  | { type: 'modifier-position'; ticket: number }
  | { type: 'modifier-ordre'; ticket: number }
  | { type: 'fermeture-partielle'; ticket: number }
  | { type: 'suiveur'; ticket: number }
  | { type: 'specification'; symbole: string }
  | { type: 'symboles' }
  | { type: 'compte' }
  | { type: 'connexion'; login?: number }
  | { type: 'depot' }
  | { type: 'indicateur'; indicateur: TypeIndicateur; graphique: string; existant?: string }
  | { type: 'liste-indicateurs'; graphique: string }
  | { type: 'objets'; graphique: string }
  | { type: 'objet'; graphique: string; id: string }
  | { type: 'proprietes'; graphique: string }
  | { type: 'options' }
  | { type: 'unclic' }
  | { type: 'alerte'; id?: string; symbole?: string }
  | { type: 'profondeur'; symbole: string }
  | { type: 'resultat'; titre: string; message: string; erreur: boolean }
  | { type: 'apropos' }
  | { type: 'raccourcis' }
  | { type: 'expert'; graphique: string; expert?: import('./algo/experts').TypeExpert }
  | { type: 'rapport' }
  | { type: 'synchro' }
  | { type: 'acces'; acces: Acces };

/** Ce qu'affiche la barre d'état au survol d'un graphique. */
export interface Survol {
  temps: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  chiffres: number;
  /** Graphique survolé et valeurs de ses indicateurs à cette barre (fenêtre de données). */
  symbole?: string;
  periode?: string;
  indicateurs?: { nom: string; lignes: { nom: string; valeur: number | null; couleur: string }[] }[];
}

/** Outil de dessin en attente de clics sur un graphique. */
export type OutilDessin = import('./etat').ObjetGraphique['type'] | null;

export interface Terminal {
  etat: EtatTerminal;
  maj: (f: (e: EtatTerminal) => EtatTerminal) => void;
  compte: Compte;
  cotations: Record<string, Cotation>;
  /** Exécute une opération du moteur sur le compte actif, affiche le résultat et joue le son. */
  operer: (f: (c: Compte) => Resultat, options?: { confirmation?: boolean; silencieux?: boolean }) => Resultat;
  dialogue: Dialogue | null;
  ouvrir: (d: Dialogue) => void;
  fermer: () => void;
  majGraphique: (id: string, patch: Partial<Graphique> | ((g: Graphique) => Partial<Graphique>)) => void;
  ouvrirGraphique: (symbole: string, periode?: Periode) => void;
  signaler: (message: string) => void;
  survol: (s: Survol | null) => void;
  /** Barre survolée sur un graphique (fenêtre de données du mobile). */
  survolActuel: Survol | null;
  outil: OutilDessin;
  choisirOutil: (o: OutilDessin) => void;
  mobile: boolean;
  /** Compte Parnassa : synchronisation entre appareils. */
  synchro: Synchro;
  /** Comptes en ligne : connexion par numéro, mot de passe et serveur. */
  enLigne: ComptesEnLigne;
}

export const ContexteTerminal = createContext<Terminal | null>(null);

export function useTerminal(): Terminal {
  const t = useContext(ContexteTerminal);
  if (!t) throw new Error('Terminal non initialisé');
  return t;
}
