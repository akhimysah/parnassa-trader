/**
 * Cotations Bid/Ask de tous les symboles du terminal. Chaque source donne un prix « milieu » :
 *  - crypto : milieu du carnet Binance (bookTicker) + statistiques 24 h (miniTicker) ;
 *  - métaux et forex : milieu des Bid/Ask réels de Swissquote (relais, chaque seconde) ;
 *  - autres : hub src/marche/flux.ts (Yahoo en continu, or animé par PAXG, scanner).
 * Le Bid/Ask affiché = milieu ± le spread du type de compte actif (Standard ou Raw), élargi au rollover
 * et, pour les métaux, au rythme des variations du spread réel de Swissquote.
 * Les composants s'abonnent par useCotations() ; les rafraîchissements sont regroupés (4 par seconde au plus).
 */
import { useSyncExternalStore } from 'react';
import { abonner as abonnerFlux, lireTick, type SourceInstrument } from './flux';
import { WS_BINANCE } from './binance';
import { RELAIS } from './bougies';
import { SYMBOLES_CONVERSION, facteurRollover, point, spreadPoints, symbole, type SymboleMT, type TypeCompte } from './symboles';

export interface Cotation {
  bid: number;
  ask: number;
  /** Plus haut / plus bas du jour (sur le Bid). */
  haut: number;
  bas: number;
  /** Prix de référence pour la variation journalière. */
  ouverture: number;
  heure: number;
  /** Sens du dernier mouvement du Bid : coloration bleue / rouge de l'Observation du marché. */
  sens: 1 | -1 | 0;
}

export interface TickHistorique {
  t: number;
  bid: number;
  ask: number;
}

const cotations: Record<string, Cotation> = {};
const ticks: Record<string, TickHistorique[]> = {};
const ecouteurs = new Set<() => void>();
let instantane: Record<string, Cotation> = {};
let prevu = false;

function publier() {
  if (prevu) return;
  prevu = true;
  setTimeout(() => {
    prevu = false;
    instantane = { ...cotations };
    for (const f of ecouteurs) f();
  }, 250);
}

// ---------- Spread du courtier ----------

let typeCompte: TypeCompte = 'standard';
const milieux: Record<string, { milieu: number; stats?: { haut: number; bas: number; ouverture: number }; facteur: number }> = {};

/** Publie un prix milieu : Bid/Ask = milieu ∓ demi-spread du type de compte actif. */
function coter(s: SymboleMT, milieu: number, stats?: { haut: number; bas: number; ouverture: number }, facteur = 1) {
  if (!(milieu > 0)) return;
  milieux[s.nom] = { milieu, stats, facteur };
  const ecart = Math.max(1, Math.round(spreadPoints(s, typeCompte) * facteur * facteurRollover(s))) * point(s);
  const bid = Number((milieu - ecart / 2).toFixed(s.chiffres));
  const ask = Number((bid + ecart).toFixed(s.chiffres));
  enregistrer(s.nom, bid, ask, stats);
}

/** Change le type du compte actif : tous les Bid/Ask sont recalculés avec ses spreads. */
export function definirTypeCompte(t: TypeCompte) {
  if (t === typeCompte) return;
  typeCompte = t;
  for (const [nom, m] of Object.entries(milieux)) {
    const s = symbole(nom);
    if (s) coter(s, m.milieu, m.stats, m.facteur);
  }
}

export function typeCompteActif(): TypeCompte {
  return typeCompte;
}

function enregistrer(nom: string, bid: number, ask: number, stats?: { haut: number; bas: number; ouverture: number }) {
  if (!(bid > 0) || !(ask > 0)) return;
  const ancien = cotations[nom];
  if (ancien && ancien.bid === bid && ancien.ask === ask && !stats) return;
  const haut = stats?.haut ?? Math.max(ancien?.haut ?? bid, bid);
  const bas = stats?.bas ?? Math.min(ancien?.bas ?? bid, bid);
  cotations[nom] = {
    bid,
    ask,
    haut: Math.max(haut, bid),
    bas: Math.min(bas, bid),
    ouverture: stats?.ouverture ?? ancien?.ouverture ?? bid,
    heure: Date.now(),
    sens: ancien ? (bid > ancien.bid ? 1 : bid < ancien.bid ? -1 : ancien.sens) : 0,
  };
  if (!ancien || ancien.bid !== bid || ancien.ask !== ask) {
    const liste = (ticks[nom] ??= []);
    liste.push({ t: Date.now(), bid, ask });
    if (liste.length > 400) liste.splice(0, liste.length - 400);
  }
  publier();
}

// ---------- Crypto : carnet Binance ----------

let wsBinance: WebSocket | null = null;
let cleBinance = '';
const parPaire = new Map<string, string>();
const stats24h: Record<string, { haut: number; bas: number; ouverture: number }> = {};

function synchroniserBinance(syms: SymboleMT[]) {
  const paires = [...new Set(syms.map((s) => s.direct.binance).filter((p): p is string => Boolean(p)))].sort();
  const cle = paires.join(',');
  if (cle === cleBinance) return;
  cleBinance = cle;
  parPaire.clear();
  for (const s of syms) if (s.direct.binance) parPaire.set(s.direct.binance, s.nom);
  if (wsBinance) {
    wsBinance.onclose = null;
    wsBinance.close();
    wsBinance = null;
  }
  if (!cle) return;
  let tentative = 0;
  const ouvrir = () => {
    const flux = paires.flatMap((p) => [`${p.toLowerCase()}@bookTicker`, `${p.toLowerCase()}@miniTicker`]).join('/');
    const ws = new WebSocket(`${WS_BINANCE}?streams=${flux}`);
    wsBinance = ws;
    ws.onopen = () => {
      tentative = 0;
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { stream?: string; data?: Record<string, string> };
      const d = m.data;
      if (!d || !m.stream) return;
      const nom = parPaire.get(d.s);
      if (!nom) return;
      const s = symbole(nom);
      if (!s) return;
      if (m.stream.endsWith('@bookTicker')) {
        coter(s, (Number(d.b) + Number(d.a)) / 2, stats24h[nom]);
      } else {
        stats24h[nom] = { haut: Number(d.h), bas: Number(d.l), ouverture: Number(d.o) };
        const c = milieux[nom];
        if (c) coter(s, c.milieu, stats24h[nom], c.facteur);
      }
    };
    ws.onclose = () => {
      if (wsBinance !== ws || cleBinance !== cle) return;
      tentative += 1;
      window.setTimeout(ouvrir, Math.min(30000, 1000 * 2 ** tentative));
    };
    ws.onerror = () => ws.close();
  };
  ouvrir();
}

// ---------- Autres symboles : hub « milieu » ----------

let desabonnerFlux: (() => void) | null = null;
let cleFlux = '';
let sourcesFlux: { s: SymboleMT; source: SourceInstrument }[] = [];

/** Statistiques du jour (haut, bas, ouverture) des symboles cotés par Swissquote, prises au hub. */
const statsFlux: Record<string, { haut: number; bas: number; ouverture: number }> = {};

function lireFlux() {
  for (const { s, source } of sourcesFlux) {
    const t = lireTick(source);
    if (!t) continue;
    // Swissquote frais : il fixe le Bid/Ask, le hub ne fournit plus que les statistiques du jour.
    if (s.direct.swissquote && swissquoteFrais(s.nom)) {
      statsFlux[s.nom] = { haut: t.haut24h, bas: t.bas24h, ouverture: t.ouverture24h };
      continue;
    }
    coter(s, t.prix, { haut: t.haut24h, bas: t.bas24h, ouverture: t.ouverture24h });
  }
}

function synchroniserFlux(syms: SymboleMT[]) {
  const voulus = syms.filter((s) => !s.direct.binance && s.direct.tradingview);
  const cle = voulus.map((s) => s.nom).sort().join(',');
  if (cle === cleFlux) return;
  cleFlux = cle;
  desabonnerFlux?.();
  desabonnerFlux = null;
  sourcesFlux = voulus.map((s) => ({
    s,
    source: { id: s.direct.tradingview!, cle: s.direct.tradingview!.split(':').pop()!.toUpperCase(), yahoo: s.direct.yahoo, pilote: s.direct.pilote },
  }));
  if (sourcesFlux.length) desabonnerFlux = abonnerFlux(sourcesFlux.map((x) => x.source), lireFlux);
}

// ---------- Métaux et forex : Bid/Ask réels Swissquote (relais, chaque seconde) ----------

const swissquote: Record<string, { recuLe: number }> = {};
/** Spread Swissquote habituel (moyenne mobile) : son écart à la moyenne élargit ou resserre le spread affiché. */
const spreadMoyenSwissquote: Record<string, number> = {};
let symbolesSwissquote: SymboleMT[] = [];
let minuteurSwissquote: number | undefined;
let swissquoteEnCours = false;
let toursSwissquote = 0;

function swissquoteFrais(nom: string): boolean {
  const q = swissquote[nom];
  return Boolean(q && Date.now() - q.recuLe < 10000);
}

async function tourSwissquote() {
  if (swissquoteEnCours || symbolesSwissquote.length === 0) return;
  // Onglet caché : un appel toutes les 5 s seulement (le relais est partagé et limité), assez pour que
  // les stops et ordres en attente suivent toujours les vrais prix.
  toursSwissquote += 1;
  if (document.visibilityState === 'hidden' && toursSwissquote % 5 !== 0) return;
  swissquoteEnCours = true;
  try {
    const liste = symbolesSwissquote.map((s) => s.direct.swissquote).join(',');
    const r = await fetch(`${RELAIS}/swissquote?i=${encodeURIComponent(liste)}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    const d = (await r.json()) as { cotations?: Record<string, { bid: number; ask: number }> };
    for (const s of symbolesSwissquote) {
      const q = d.cotations?.[s.direct.swissquote!.replace('/', '')];
      if (!q) continue;
      swissquote[s.nom] = { recuLe: Date.now() };
      const ecart = q.ask - q.bid;
      const moyen = (spreadMoyenSwissquote[s.nom] = spreadMoyenSwissquote[s.nom] ? spreadMoyenSwissquote[s.nom] * 0.97 + ecart * 0.03 : ecart);
      // Annonce, faible liquidité : le spread réel s'écarte, le spread affiché suit dans la même proportion.
      const facteur = Math.min(4, Math.max(0.8, moyen > 0 ? ecart / moyen : 1));
      coter(s, (q.bid + q.ask) / 2, statsFlux[s.nom], facteur);
    }
  } catch {
    // relais indisponible : la cotation de secours (hub) reprend après 10 s
  } finally {
    swissquoteEnCours = false;
  }
}

function synchroniserSwissquote(syms: SymboleMT[]) {
  symbolesSwissquote = syms.filter((s) => s.direct.swissquote);
  if (symbolesSwissquote.length && minuteurSwissquote === undefined) {
    void tourSwissquote();
    minuteurSwissquote = window.setInterval(() => void tourSwissquote(), 1000);
  } else if (!symbolesSwissquote.length && minuteurSwissquote !== undefined) {
    window.clearInterval(minuteurSwissquote);
    minuteurSwissquote = undefined;
  }
}

/** Source affichée pour un symbole (spécification, Observation du marché). */
export function sourceDirecte(nom: string): 'swissquote' | 'binance' | 'secours' {
  if (swissquoteFrais(nom)) return 'swissquote';
  return symbole(nom)?.direct.binance ? 'binance' : 'secours';
}

/** Définit les symboles à coter (Observation du marché, positions, ordres) ; les taux de conversion sont toujours inclus. */
export function definirAbonnements(noms: string[]) {
  const syms = [...new Set([...noms, ...SYMBOLES_CONVERSION])].map(symbole).filter((s): s is SymboleMT => Boolean(s));
  synchroniserBinance(syms);
  synchroniserFlux(syms);
  synchroniserSwissquote(syms);
}

function souscrire(f: () => void) {
  ecouteurs.add(f);
  return () => {
    ecouteurs.delete(f);
  };
}

export function useCotations(): Record<string, Cotation> {
  return useSyncExternalStore(souscrire, () => instantane);
}

export function cotationsActuelles(): Record<string, Cotation> {
  return instantane;
}

/** Derniers ticks reçus pour un symbole (graphique des ticks). */
export function historiqueTicks(nom: string): TickHistorique[] {
  return ticks[nom] ?? [];
}

export function milieu(c: Cotation | undefined): number | undefined {
  return c ? (c.bid + c.ask) / 2 : undefined;
}
