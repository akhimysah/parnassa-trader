/**
 * Cotations Bid/Ask de tous les symboles du terminal.
 *  - crypto : vrai meilleur acheteur / vendeur du carnet Binance (bookTicker) + statistiques 24 h (miniTicker) ;
 *  - autres : cotation « milieu » du hub src/marche/flux.ts (Yahoo en continu, or animé par PAXG, scanner),
 *    élargie de l'écart fixe du symbole.
 * Les composants s'abonnent par useCotations() ; les rafraîchissements sont regroupés (4 par seconde au plus).
 */
import { useSyncExternalStore } from 'react';
import { abonner as abonnerFlux, lireTick, type SourceInstrument } from './flux';
import { WS_BINANCE } from './binance';
import { SYMBOLES_CONVERSION, point, symbole, type SymboleMT } from './symboles';

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
      if (m.stream.endsWith('@bookTicker')) {
        enregistrer(nom, Number(d.b), Number(d.a), stats24h[nom]);
      } else {
        stats24h[nom] = { haut: Number(d.h), bas: Number(d.l), ouverture: Number(d.o) };
        const c = cotations[nom];
        if (c) enregistrer(nom, c.bid, c.ask, stats24h[nom]);
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

function lireFlux() {
  for (const { s, source } of sourcesFlux) {
    const t = lireTick(source);
    if (!t) continue;
    const demi = (s.spread * point(s)) / 2;
    const bid = Number((t.prix - demi).toFixed(s.chiffres));
    const ask = Number((t.prix + demi).toFixed(s.chiffres));
    enregistrer(s.nom, bid, ask, { haut: t.haut24h, bas: t.bas24h, ouverture: t.ouverture24h });
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

/** Définit les symboles à coter (Observation du marché, positions, ordres) ; les taux de conversion sont toujours inclus. */
export function definirAbonnements(noms: string[]) {
  const syms = [...new Set([...noms, ...SYMBOLES_CONVERSION])].map(symbole).filter((s): s is SymboleMT => Boolean(s));
  synchroniserBinance(syms);
  synchroniserFlux(syms);
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
