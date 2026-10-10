/**
 * Exécution côté serveur (terminal fermé) : le serveur Parnassa-Trader rejoue les dernières bougies 1 minute de
 * chaque symbole, puis le prix actuel, dans le même moteur que le terminal. Les stop-loss, take-profit, stops
 * suiveurs, ordres en attente, expirations, swaps et stop-out se déclenchent donc même application fermée.
 * Module pur : utilisé par le worker (serveur/) et par les tests.
 */
import type { Cotation } from '../marche/cotations';
import { facteurRollover, point, spreadPoints, symbole, type TypeCompte } from '../marche/symboles';
import { appliquerCotations, type Compte, type Evenement } from './moteur';

/** Bougie 1 minute : `t` en millisecondes (début de la minute), prix « milieu ». */
export interface Barre {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface PrixServeur {
  /** Dernier prix milieu connu. */
  milieu: number;
  /** Bougies 1 minute récentes, des plus anciennes aux plus récentes. */
  barres: Barre[];
  /** Écart Bid/Ask réel en prix (carnet Binance) ; sinon le spread du type de compte. */
  ecart?: number;
}

/** Bid/Ask d'un prix milieu, avec le spread du type de compte (comme le terminal). */
export function cotationServeur(nom: string, milieu: number, type: TypeCompte, ecartReel?: number, heure = Date.now()): Cotation | null {
  const s = symbole(nom);
  if (!s || !(milieu > 0)) return null;
  const ecart = ecartReel && ecartReel > 0 ? ecartReel : Math.max(1, Math.round(spreadPoints(s, type) * facteurRollover(s, heure))) * point(s);
  const bid = Number((milieu - ecart / 2).toFixed(s.chiffres));
  const ask = Number((bid + ecart).toFixed(s.chiffres));
  return { bid, ask, haut: bid, bas: bid, ouverture: bid, heure, sens: 0 };
}

/** Chemin des prix dans une bougie : ouverture, l'extrême le plus proche d'abord, l'autre, clôture. */
function chemin(b: Barre): number[] {
  return b.c >= b.o ? [b.o, b.l, b.h, b.c] : [b.o, b.h, b.l, b.c];
}

/** Types d'événements qui justifient d'enregistrer le compte et de prévenir le client. */
export const EVENEMENTS_NOTABLES: Evenement['type'][] = ['execution', 'sl', 'tp', 'stop-out', 'expiration', 'rejet'];

/**
 * Rejoue les bougies commencées après `depuis` puis le prix actuel. Renvoie le compte, les événements
 * (sans doublon) et s'il a changé d'une façon qui mérite d'être enregistrée.
 */
export function executerHorsLigne(c: Compte, prix: Record<string, PrixServeur>, depuis: number, maintenant = Date.now()): { compte: Compte; evenements: Evenement[]; modifie: boolean } {
  const type = c.type ?? 'standard';
  const noms = Object.keys(prix);
  const cot = (milieux: Record<string, number>) => {
    const sortie: Record<string, Cotation> = {};
    for (const n of noms) {
      const q = cotationServeur(n, milieux[n], type, prix[n].ecart, maintenant);
      if (q) sortie[n] = q;
    }
    return sortie;
  };
  const temps = [...new Set(noms.flatMap((n) => prix[n].barres.filter((b) => b.t >= depuis && b.t <= maintenant).map((b) => b.t)))].sort((a, b) => a - b);
  // Point de départ : la clôture de la dernière bougie déjà vue, sinon le prix actuel.
  const courants: Record<string, number> = {};
  for (const n of noms) {
    const avant = prix[n].barres.filter((b) => b.t < (temps[0] ?? Infinity));
    courants[n] = avant.length ? avant[avant.length - 1].c : prix[n].milieu;
  }
  let compte = c;
  const evenements: Evenement[] = [];
  const vus = new Set<string>();
  const appliquer = (milieux: Record<string, number>) => {
    const r = appliquerCotations(compte, cot(milieux));
    compte = r.compte;
    for (const e of r.evenements) {
      const cle = `${e.type}:${e.message}`;
      if (!vus.has(cle)) evenements.push(e);
      vus.add(cle);
    }
  };
  for (const t of temps) {
    const barres = noms.map((n) => [n, prix[n].barres.find((b) => b.t === t)] as const);
    for (let k = 0; k < 4; k++) {
      for (const [n, b] of barres) if (b) courants[n] = chemin(b)[k];
      appliquer(courants);
    }
  }
  appliquer(Object.fromEntries(noms.map((n) => [n, prix[n].milieu])));
  const swaps = (x: Compte) => x.positions.map((p) => `${p.ticket}:${p.dernierSwap ?? 0}`).join(',');
  const modifie = evenements.some((e) => EVENEMENTS_NOTABLES.includes(e.type)) || swaps(compte) !== swaps(c);
  return { compte, evenements, modifie };
}

/** Symboles dont le serveur a besoin pour un compte : ceux des positions et ordres, et les paires de conversion. */
export function symbolesCompte(c: Compte): string[] {
  return [...new Set([...c.positions.map((p) => p.symbole), ...c.ordres.map((o) => o.symbole)])];
}
