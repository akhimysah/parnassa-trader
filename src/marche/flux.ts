/**
 * Hub de cotations en temps réel, partagé par toute l'application (une seule connexion par source) :
 *  - flux Yahoo Finance (WebSocket, ~1 mise à jour par seconde) : forex, dollar index, indices, actions ;
 *  - or animé seconde par seconde par le carnet d'ordres du PAX Gold (Binance), recalé en continu sur XAUUSD ;
 *  - scanner TradingView interrogé chaque seconde : référence de tous les instruments, et seule source
 *    pour l'argent, le platine, le cuivre et l'énergie.
 */
import type { Tick } from './binance';

export interface SourceInstrument {
  id: string;
  cle: string;
  yahoo?: string;
  /** Instrument dont le prix est animé par une paire Binance (ex. or ← PAXGUSDT). */
  pilote?: string;
}

const URL_SCANNER = 'https://scanner.tradingview.com/global/scan';
const URL_YAHOO = 'wss://streamer.finance.yahoo.com/?version=2';
const URL_BINANCE = 'wss://data-stream.binance.vision/ws';
/** Un tick Yahoo plus vieux que ça cède la place au scanner (marché fermé, flux coupé…). */
const FRAICHEUR_YAHOO = 90000;

const abonnes = new Map<string, { source: SourceInstrument; compte: number }>();
const scanner: Record<string, Tick> = {};
const yahoo: Record<string, Tick> = {};
const pilotes: Record<string, number> = {};
/** Ancrage des instruments pilotés : cotation de référence et prix du pilote au même instant. */
const ancrages: Record<string, { reference: number; pilote: number }> = {};
const ecouteurs = new Set<() => void>();
let notificationPrevue = false;

function notifier() {
  // Regroupe les mises à jour : au plus 4 rafraîchissements d'écran par seconde.
  if (notificationPrevue) return;
  notificationPrevue = true;
  setTimeout(() => {
    notificationPrevue = false;
    for (const f of ecouteurs) f();
  }, 250);
}

/** Cotation retenue pour un instrument : Yahoo si frais, sinon instrument piloté, sinon scanner. */
export function lireTick(source: SourceInstrument): Tick | undefined {
  const base = scanner[source.cle];
  const y = source.yahoo ? yahoo[source.cle] : undefined;
  if (y && Date.now() - y.recuLe < FRAICHEUR_YAHOO) return y;
  if (source.pilote && base) {
    const prixPilote = pilotes[source.pilote];
    const ancrage = ancrages[source.cle];
    if (prixPilote && ancrage) {
      const prix = ancrage.reference * (prixPilote / ancrage.pilote);
      return { ...base, prix, haut24h: Math.max(base.haut24h, prix), bas24h: Math.min(base.bas24h, prix), recuLe: Date.now() };
    }
  }
  return base;
}

// ---------- Scanner (toutes les secondes) ----------

let minuteurScanner: number | undefined;
let scannerEnCours = false;

async function tourScanner() {
  const sources = [...abonnes.values()].map((a) => a.source);
  if (sources.length === 0 || scannerEnCours) return;
  // Onglet caché : on suspend les rafraîchissements, sauf pour donner un premier prix aux nouveaux symboles.
  const sansPrix = sources.filter((src) => !scanner[src.cle]);
  if (document.visibilityState === 'hidden' && sansPrix.length === 0) return;
  const ids = (document.visibilityState === 'hidden' ? sansPrix : sources).map((src) => src.id);
  scannerEnCours = true;
  try {
    // Corps en texte brut : requête « simple », sans pré-vérification CORS (refusée pour application/json).
    const r = await fetch(URL_SCANNER, {
      method: 'POST',
      body: JSON.stringify({ symbols: { tickers: ids }, columns: ['close', 'change', 'high', 'low'] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return;
    const d = (await r.json()) as { data?: { s: string; d: (number | null)[] }[] };
    if (!d.data) return;
    const maintenant = Date.now();
    for (const ligne of d.data) {
      const [close, change, haut, bas] = ligne.d;
      if (typeof close !== 'number') continue;
      const cle = ligne.s.split(':').pop()!.toUpperCase();
      const ancien = scanner[cle];
      scanner[cle] = {
        prix: close,
        ouverture24h: close / (1 + (typeof change === 'number' ? change : 0) / 100),
        haut24h: typeof haut === 'number' ? haut : close,
        bas24h: typeof bas === 'number' ? bas : close,
        volume24h: 0,
        recuLe: maintenant,
      };
      // Nouvelle cotation de référence : on recale l'instrument piloté sur le prix actuel du pilote.
      const source = [...abonnes.values()].find((a) => a.source.cle === cle)?.source;
      if (source?.pilote && pilotes[source.pilote] && (!ancien || ancien.prix !== close || !ancrages[cle])) {
        ancrages[cle] = { reference: close, pilote: pilotes[source.pilote] };
      }
    }
    notifier();
  } catch {
    // réseau indisponible : nouvel essai à la seconde suivante
  } finally {
    scannerEnCours = false;
  }
}

// ---------- Yahoo Finance (WebSocket, protobuf en base64) ----------

let wsYahoo: WebSocket | null = null;
let yahooAbonnes = new Set<string>();
let tentativeYahoo = 0;
let minuteurYahoo: number | undefined;

function lireVarint(b: Uint8Array, i: number): [number, number] {
  let r = 0;
  let mult = 1;
  for (;;) {
    const o = b[i++];
    r += (o & 0x7f) * mult;
    if (!(o & 0x80)) break;
    mult *= 128;
  }
  return [r, i];
}

/** Décode le message « PricingData » de Yahoo : 1 id, 2 prix, 8 variation %, 10 plus haut, 11 plus bas. */
function decoderYahoo(texte: string): { id: string; prix: number; variation?: number; haut?: number; bas?: number } | null {
  let binaire: string;
  try {
    binaire = atob(texte);
  } catch {
    return null;
  }
  const b = Uint8Array.from(binaire, (c) => c.charCodeAt(0));
  const vue = new DataView(b.buffer);
  const champs: Record<number, number | string> = {};
  let i = 0;
  while (i < b.length) {
    let cle: number;
    [cle, i] = lireVarint(b, i);
    const num = Math.floor(cle / 8);
    const type = cle % 8;
    if (type === 0) {
      let v: number;
      [v, i] = lireVarint(b, i);
      champs[num] = v;
    } else if (type === 5) {
      champs[num] = vue.getFloat32(i, true);
      i += 4;
    } else if (type === 1) {
      champs[num] = vue.getFloat64(i, true);
      i += 8;
    } else if (type === 2) {
      let l: number;
      [l, i] = lireVarint(b, i);
      champs[num] = new TextDecoder().decode(b.subarray(i, i + l));
      i += l;
    } else break;
  }
  if (typeof champs[1] !== 'string' || typeof champs[2] !== 'number') return null;
  return {
    id: champs[1],
    prix: champs[2],
    variation: typeof champs[8] === 'number' ? champs[8] : undefined,
    haut: typeof champs[10] === 'number' ? champs[10] : undefined,
    bas: typeof champs[11] === 'number' ? champs[11] : undefined,
  };
}

/** Arrondi qui gomme l'imprécision du flottant 32 bits envoyé par Yahoo (1.1171700... → 1.11717). */
function arrondir(v: number): number {
  const chiffres = Math.max(0, 6 - Math.floor(Math.log10(Math.abs(v) || 1)));
  return Number(v.toFixed(Math.min(chiffres, 6)));
}

function symbolesYahooVoulus(): Set<string> {
  return new Set([...abonnes.values()].map((a) => a.source.yahoo).filter((y): y is string => Boolean(y)));
}

function synchroniserYahoo() {
  const voulus = symbolesYahooVoulus();
  if (voulus.size === 0) {
    if (wsYahoo) {
      wsYahoo.onclose = null;
      wsYahoo.close();
      wsYahoo = null;
      yahooAbonnes = new Set();
    }
    return;
  }
  if (!wsYahoo) {
    connecterYahoo();
    return;
  }
  if (wsYahoo.readyState !== WebSocket.OPEN) return;
  const ajout = [...voulus].filter((s) => !yahooAbonnes.has(s));
  const retrait = [...yahooAbonnes].filter((s) => !voulus.has(s));
  if (ajout.length) wsYahoo.send(JSON.stringify({ subscribe: ajout }));
  if (retrait.length) wsYahoo.send(JSON.stringify({ unsubscribe: retrait }));
  yahooAbonnes = voulus;
}

function connecterYahoo() {
  const ws = new WebSocket(URL_YAHOO);
  wsYahoo = ws;
  yahooAbonnes = new Set();
  ws.onopen = () => {
    tentativeYahoo = 0;
    synchroniserYahoo();
  };
  ws.onmessage = (e) => {
    let texte = String(e.data);
    if (texte.startsWith('{')) {
      try {
        texte = (JSON.parse(texte) as { message?: string }).message ?? '';
      } catch {
        return;
      }
    }
    const m = decoderYahoo(texte);
    if (!m) return;
    const sources = [...abonnes.values()].filter((a) => a.source.yahoo === m.id).map((a) => a.source);
    if (sources.length === 0) return;
    const prix = arrondir(m.prix);
    for (const s of sources) {
      const base = scanner[s.cle];
      yahoo[s.cle] = {
        prix,
        ouverture24h: m.variation !== undefined ? prix / (1 + m.variation / 100) : (base?.ouverture24h ?? prix),
        haut24h: m.haut ? arrondir(m.haut) : (base?.haut24h ?? prix),
        bas24h: m.bas ? arrondir(m.bas) : (base?.bas24h ?? prix),
        volume24h: 0,
        recuLe: Date.now(),
      };
    }
    notifier();
  };
  ws.onclose = () => {
    if (wsYahoo !== ws) return;
    wsYahoo = null;
    if (symbolesYahooVoulus().size === 0) return;
    tentativeYahoo += 1;
    window.clearTimeout(minuteurYahoo);
    minuteurYahoo = window.setTimeout(connecterYahoo, Math.min(30000, 1000 * 2 ** tentativeYahoo));
  };
  ws.onerror = () => ws.close();
}

// ---------- Pilotes Binance (transactions en continu) ----------

let wsPilotes: WebSocket | null = null;
let clePilotes = '';

function synchroniserPilotes() {
  const voulus = [...new Set([...abonnes.values()].map((a) => a.source.pilote).filter((p): p is string => Boolean(p)))].sort();
  const cle = voulus.join(',');
  if (cle === clePilotes) return;
  clePilotes = cle;
  if (wsPilotes) {
    wsPilotes.onclose = null;
    wsPilotes.close();
    wsPilotes = null;
  }
  if (!cle) return;
  const ouvrir = () => {
    // Meilleur acheteur / vendeur : bouge bien plus souvent que les transactions (≈ 1,4 fois par seconde sur PAXG).
    const ws = new WebSocket(`${URL_BINANCE}/${voulus.map((p) => `${p.toLowerCase()}@bookTicker`).join('/')}`);
    wsPilotes = ws;
    ws.onmessage = (e) => {
      const d = JSON.parse(String(e.data)) as { s?: string; b?: string; a?: string };
      if (!d.s || !d.b || !d.a) return;
      const milieu = (Number(d.b) + Number(d.a)) / 2;
      if (pilotes[d.s] === milieu) return;
      pilotes[d.s] = milieu;
      // Premier ancrage dès que la cotation de référence est connue.
      for (const a of abonnes.values()) {
        if (a.source.pilote === d.s && !ancrages[a.source.cle] && scanner[a.source.cle]) {
          ancrages[a.source.cle] = { reference: scanner[a.source.cle].prix, pilote: pilotes[d.s] };
        }
      }
      notifier();
    };
    ws.onclose = () => {
      if (wsPilotes === ws && clePilotes === cle) window.setTimeout(ouvrir, 3000);
    };
    ws.onerror = () => ws.close();
  };
  ouvrir();
}

// ---------- Abonnements ----------

export function abonner(sources: SourceInstrument[], ecouteur: () => void): () => void {
  for (const s of sources) {
    const a = abonnes.get(s.id);
    if (a) a.compte += 1;
    else abonnes.set(s.id, { source: s, compte: 1 });
  }
  ecouteurs.add(ecouteur);
  synchroniserYahoo();
  synchroniserPilotes();
  if (minuteurScanner === undefined) {
    void tourScanner();
    minuteurScanner = window.setInterval(() => void tourScanner(), 1000);
  } else {
    // Nouveaux symboles : cotation immédiate sans attendre la seconde suivante.
    void tourScanner();
  }
  return () => {
    for (const s of sources) {
      const a = abonnes.get(s.id);
      if (!a) continue;
      a.compte -= 1;
      if (a.compte <= 0) abonnes.delete(s.id);
    }
    ecouteurs.delete(ecouteur);
    synchroniserYahoo();
    synchroniserPilotes();
    if (abonnes.size === 0 && minuteurScanner !== undefined) {
      window.clearInterval(minuteurScanner);
      minuteurScanner = undefined;
    }
  };
}
