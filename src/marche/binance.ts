/** Point d'accès public « market data » de Binance, joignable depuis toutes les régions, sans clé. */
export const WS_BINANCE = 'wss://data-stream.binance.vision/stream';
export const REST_BINANCE = 'https://data-api.binance.vision/api/v3';

/** Cotation « milieu » d'un instrument (format partagé avec le hub src/marche/flux.ts). */
export interface Tick {
  prix: number;
  ouverture24h: number;
  haut24h: number;
  bas24h: number;
  volume24h: number;
  recuLe: number;
}

export interface Bougie {
  /** Ouverture de la bougie, en secondes UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Bougies Binance (500 par appel, 1 000 au plus), de la plus ancienne à la plus récente. */
export async function klines(paire: string, intervalle: string, limite = 1000, fin?: number): Promise<Bougie[]> {
  const url = `${REST_BINANCE}/klines?symbol=${paire}&interval=${intervalle}&limit=${limite}${fin ? `&endTime=${fin}` : ''}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Binance ${r.status}`);
  const d = (await r.json()) as (string | number)[][];
  return d.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

export interface Carnet {
  bids: [number, number][];
  asks: [number, number][];
}

/** Profondeur de marché (20 niveaux) d'une paire Binance, rafraîchie à chaque message (100 ms). */
export function abonnerProfondeur(paire: string, rappel: (c: Carnet) => void): () => void {
  let ws: WebSocket | null = null;
  let ferme = false;
  const ouvrir = () => {
    ws = new WebSocket(`${WS_BINANCE}?streams=${paire.toLowerCase()}@depth20@100ms`);
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { data?: { bids: string[][]; asks: string[][] } };
      if (!m.data) return;
      rappel({
        bids: m.data.bids.map(([p, q]) => [Number(p), Number(q)]),
        asks: m.data.asks.map(([p, q]) => [Number(p), Number(q)]),
      });
    };
    ws.onclose = () => {
      if (!ferme) window.setTimeout(ouvrir, 3000);
    };
    ws.onerror = () => ws?.close();
  };
  ouvrir();
  return () => {
    ferme = true;
    ws?.close();
  };
}
