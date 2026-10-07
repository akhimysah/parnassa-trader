/**
 * Catalogue des symboles du terminal, nommés comme chez un courtier MetaTrader 5 (EURUSD, XAUUSD, US500…).
 * Chaque symbole précise d'où viennent ses cotations en direct et son historique de bougies.
 */

export type Categorie = 'forex' | 'metaux' | 'indices' | 'energie' | 'actions-us' | 'actions-fr' | 'crypto';
export type Devise = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CHF' | 'CAD' | 'AUD' | 'NZD';

export interface SymboleMT {
  /** Nom MetaTrader, ex. « EURUSD ». */
  nom: string;
  description: string;
  /** Chemin dans l'arborescence des symboles, ex. « Forex\Majeures ». */
  chemin: string;
  categorie: Categorie;
  /** Nombre de décimales de la cotation. */
  chiffres: number;
  /** Taille du contrat : unités de l'actif pour 1 lot. */
  contrat: number;
  /** Devise de base (marge) et devise de cotation (profit). */
  base: string;
  profit: Devise;
  /** Écart fixe en points, pour les symboles cotés en prix « milieu » (la crypto a le vrai carnet Binance). */
  spread: number;
  volumeMin: number;
  volumeMax: number;
  pasVolume: number;
  /** Levier maximal appliqué par le courtier sur ce symbole (le levier du compte est plafonné à cette valeur). */
  levierMax: number;
  /** Cotations en direct. */
  /** `swissquote` : Bid/Ask réels du courtier Swissquote (via le relais), prioritaires sur les autres sources. */
  direct: { binance?: string; tradingview?: string; yahoo?: string; pilote?: string; swissquote?: string };
  /** Historique : paire Binance, ou symbole Yahoo servi par le relais. `recaler` aligne une source voisine sur la cotation. */
  histo: { binance?: string; yahoo?: string; recaler?: boolean };
}

type Options = Partial<Pick<SymboleMT, 'contrat' | 'volumeMin' | 'volumeMax' | 'pasVolume' | 'levierMax' | 'profit' | 'base'>>;

const fx = (nom: string, description: string, chemin: string, chiffres: number, spread: number): SymboleMT => ({
  nom,
  description,
  chemin: `Forex\\${chemin}`,
  categorie: 'forex',
  chiffres,
  contrat: 100000,
  base: nom.slice(0, 3),
  profit: nom.slice(3) as Devise,
  spread,
  volumeMin: 0.01,
  volumeMax: 100,
  pasVolume: 0.01,
  levierMax: 1000,
  direct: { tradingview: `FX:${nom}`, yahoo: nom.startsWith('USD') ? `${nom.slice(3)}=X` : `${nom}=X` },
  histo: { yahoo: nom.startsWith('USD') ? `${nom.slice(3)}=X` : `${nom}=X` },
});

const cfd = (
  nom: string,
  description: string,
  chemin: string,
  categorie: Categorie,
  chiffres: number,
  spread: number,
  direct: SymboleMT['direct'],
  histo: SymboleMT['histo'],
  o: Options = {},
): SymboleMT => ({
  nom,
  description,
  chemin,
  categorie,
  chiffres,
  contrat: o.contrat ?? 1,
  base: o.base ?? nom,
  profit: o.profit ?? 'USD',
  spread,
  volumeMin: o.volumeMin ?? 0.01,
  volumeMax: o.volumeMax ?? 100,
  pasVolume: o.pasVolume ?? 0.01,
  levierMax: o.levierMax ?? 100,
  direct,
  histo,
});

const crypto = (nom: string, description: string, paire: string, chiffres: number, o: Options = {}): SymboleMT =>
  cfd(nom, description, 'Crypto', 'crypto', chiffres, 0, { binance: paire }, { binance: paire }, { levierMax: 100, base: nom.replace(/USD$/, ''), ...o });

const action = (nom: string, description: string, tv: string, yahoo: string, pays: 'US' | 'FR'): SymboleMT =>
  cfd(
    nom,
    description,
    pays === 'US' ? 'Actions\\États-Unis' : 'Actions\\France',
    pays === 'US' ? 'actions-us' : 'actions-fr',
    2,
    pays === 'US' ? 6 : 8,
    { tradingview: tv, yahoo },
    { yahoo },
    { levierMax: 5, profit: pays === 'US' ? 'USD' : 'EUR', volumeMin: 1, pasVolume: 1, volumeMax: 10000 },
  );

export const SYMBOLES: SymboleMT[] = [
  // Forex — majeures
  fx('EURUSD', 'Euro vs Dollar US', 'Majeures', 5, 12),
  fx('GBPUSD', 'Livre sterling vs Dollar US', 'Majeures', 5, 15),
  fx('USDJPY', 'Dollar US vs Yen japonais', 'Majeures', 3, 14),
  fx('USDCHF', 'Dollar US vs Franc suisse', 'Majeures', 5, 16),
  fx('AUDUSD', 'Dollar australien vs Dollar US', 'Majeures', 5, 14),
  fx('USDCAD', 'Dollar US vs Dollar canadien', 'Majeures', 5, 18),
  fx('NZDUSD', 'Dollar néo-zélandais vs Dollar US', 'Majeures', 5, 20),
  // Forex — croisées
  fx('EURGBP', 'Euro vs Livre sterling', 'Croisées', 5, 15),
  fx('EURJPY', 'Euro vs Yen japonais', 'Croisées', 3, 20),
  fx('GBPJPY', 'Livre sterling vs Yen japonais', 'Croisées', 3, 30),
  fx('EURCHF', 'Euro vs Franc suisse', 'Croisées', 5, 20),
  fx('AUDJPY', 'Dollar australien vs Yen japonais', 'Croisées', 3, 22),
  fx('EURAUD', 'Euro vs Dollar australien', 'Croisées', 5, 25),
  fx('GBPCHF', 'Livre sterling vs Franc suisse', 'Croisées', 5, 30),
  // Métaux
  cfd('XAUUSD', 'Or vs Dollar US', 'Métaux', 'metaux', 2, 25, { tradingview: 'OANDA:XAUUSD', pilote: 'PAXGUSDT', swissquote: 'XAU/USD' }, { yahoo: 'GC=F', recaler: true }, { contrat: 100, levierMax: 500, base: 'XAU' }),
  cfd('XAGUSD', 'Argent vs Dollar US', 'Métaux', 'metaux', 3, 30, { tradingview: 'TVC:SILVER', swissquote: 'XAG/USD' }, { yahoo: 'SI=F', recaler: true }, { contrat: 5000, levierMax: 200, base: 'XAG' }),
  cfd('XPTUSD', 'Platine vs Dollar US', 'Métaux', 'metaux', 2, 300, { tradingview: 'TVC:PLATINUM', swissquote: 'XPT/USD' }, { yahoo: 'PL=F', recaler: true }, { contrat: 100, levierMax: 100, base: 'XPT' }),
  cfd('XPDUSD', 'Palladium vs Dollar US', 'Métaux', 'metaux', 2, 300, { tradingview: 'TVC:PALLADIUM', swissquote: 'XPD/USD' }, { yahoo: 'PA=F', recaler: true }, { contrat: 100, levierMax: 100, base: 'XPD' }),
  cfd('COPPER', 'Cuivre (contrat à terme)', 'Métaux', 'metaux', 4, 30, { tradingview: 'COMEX:HG1!' }, { yahoo: 'HG=F' }, { contrat: 25000, levierMax: 100 }),
  // Indices
  cfd('US500', 'S&P 500', 'Indices\\États-Unis', 'indices', 2, 50, { tradingview: 'SP:SPX', yahoo: '^GSPC' }, { yahoo: '^GSPC' }, { levierMax: 200 }),
  cfd('NAS100', 'Nasdaq 100', 'Indices\\États-Unis', 'indices', 2, 150, { tradingview: 'NASDAQ:NDX', yahoo: '^NDX' }, { yahoo: '^NDX' }, { levierMax: 200 }),
  cfd('US30', 'Dow Jones 30', 'Indices\\États-Unis', 'indices', 2, 300, { tradingview: 'DJ:DJI', yahoo: '^DJI' }, { yahoo: '^DJI' }, { levierMax: 200 }),
  cfd('GER40', 'DAX 40', 'Indices\\Europe', 'indices', 2, 150, { tradingview: 'XETR:DAX', yahoo: '^GDAXI' }, { yahoo: '^GDAXI' }, { levierMax: 200, profit: 'EUR' }),
  cfd('FRA40', 'CAC 40', 'Indices\\Europe', 'indices', 2, 150, { tradingview: 'EURONEXT:PX1', yahoo: '^FCHI' }, { yahoo: '^FCHI' }, { levierMax: 200, profit: 'EUR' }),
  cfd('UK100', 'FTSE 100', 'Indices\\Europe', 'indices', 2, 150, { tradingview: 'TVC:UKX', yahoo: '^FTSE' }, { yahoo: '^FTSE' }, { levierMax: 200, profit: 'GBP' }),
  cfd('JPN225', 'Nikkei 225', 'Indices\\Asie', 'indices', 2, 1000, { tradingview: 'TVC:NI225', yahoo: '^N225' }, { yahoo: '^N225' }, { levierMax: 200, profit: 'JPY', contrat: 100 }),
  // Énergie
  cfd('USOIL', 'Pétrole brut WTI', 'Énergie', 'energie', 2, 4, { tradingview: 'NYMEX:CL1!' }, { yahoo: 'CL=F' }, { contrat: 1000, levierMax: 100 }),
  cfd('UKOIL', 'Pétrole Brent', 'Énergie', 'energie', 2, 5, { tradingview: 'ICEEUR:BRN1!' }, { yahoo: 'BZ=F' }, { contrat: 1000, levierMax: 100 }),
  cfd('NATGAS', 'Gaz naturel', 'Énergie', 'energie', 3, 8, { tradingview: 'NYMEX:NG1!' }, { yahoo: 'NG=F' }, { contrat: 10000, levierMax: 100 }),
  // Crypto (vrai carnet d'ordres Binance)
  crypto('BTCUSD', 'Bitcoin vs Dollar US', 'BTCUSDT', 2),
  crypto('ETHUSD', 'Ethereum vs Dollar US', 'ETHUSDT', 2),
  crypto('SOLUSD', 'Solana vs Dollar US', 'SOLUSDT', 2),
  crypto('BNBUSD', 'BNB vs Dollar US', 'BNBUSDT', 2),
  crypto('XRPUSD', 'XRP vs Dollar US', 'XRPUSDT', 4, { contrat: 1000 }),
  crypto('DOGUSD', 'Dogecoin vs Dollar US', 'DOGEUSDT', 5, { contrat: 10000 }),
  crypto('ADAUSD', 'Cardano vs Dollar US', 'ADAUSDT', 4, { contrat: 1000 }),
  crypto('LTCUSD', 'Litecoin vs Dollar US', 'LTCUSDT', 2),
  crypto('LNKUSD', 'Chainlink vs Dollar US', 'LINKUSDT', 3, { contrat: 10 }),
  crypto('AVAUSD', 'Avalanche vs Dollar US', 'AVAXUSDT', 3, { contrat: 10 }),
  // Actions
  action('AAPL', 'Apple Inc.', 'NASDAQ:AAPL', 'AAPL', 'US'),
  action('MSFT', 'Microsoft Corporation', 'NASDAQ:MSFT', 'MSFT', 'US'),
  action('NVDA', 'NVIDIA Corporation', 'NASDAQ:NVDA', 'NVDA', 'US'),
  action('AMZN', 'Amazon.com Inc.', 'NASDAQ:AMZN', 'AMZN', 'US'),
  action('GOOGL', 'Alphabet Inc. (classe A)', 'NASDAQ:GOOGL', 'GOOGL', 'US'),
  action('META', 'Meta Platforms Inc.', 'NASDAQ:META', 'META', 'US'),
  action('TSLA', 'Tesla Inc.', 'NASDAQ:TSLA', 'TSLA', 'US'),
  action('MC', 'LVMH Moët Hennessy Louis Vuitton', 'EURONEXT:MC', 'MC.PA', 'FR'),
  action('TTE', 'TotalEnergies SE', 'EURONEXT:TTE', 'TTE.PA', 'FR'),
  action('AIR', 'Airbus SE', 'EURONEXT:AIR', 'AIR.PA', 'FR'),
  action('OR', "L'Oréal SA", 'EURONEXT:OR', 'OR.PA', 'FR'),
];

const PAR_NOM = new Map(SYMBOLES.map((s) => [s.nom, s]));

export function symbole(nom: string): SymboleMT | undefined {
  return PAR_NOM.get(nom);
}

/** Symboles affichés par défaut dans l'Observation du marché, comme un terminal fraîchement installé. */
export const OBSERVATION_DEFAUT = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'EURGBP', 'XAUUSD', 'XAGUSD', 'US500', 'NAS100', 'GER40', 'USOIL', 'BTCUSD', 'ETHUSD'];

export function point(s: SymboleMT): number {
  return Math.pow(10, -s.chiffres);
}

export function formaterPrix(s: SymboleMT | undefined, prix: number): string {
  const d = s ? s.chiffres : prix >= 100 ? 2 : 5;
  return prix.toFixed(d);
}

/** Paires de change servant à convertir la devise de profit en USD. */
const CONVERSION: Record<Exclude<Devise, 'USD'>, { nom: string; inverse: boolean; secours: number }> = {
  EUR: { nom: 'EURUSD', inverse: false, secours: 1.1 },
  GBP: { nom: 'GBPUSD', inverse: false, secours: 1.3 },
  AUD: { nom: 'AUDUSD', inverse: false, secours: 0.65 },
  NZD: { nom: 'NZDUSD', inverse: false, secours: 0.6 },
  JPY: { nom: 'USDJPY', inverse: true, secours: 150 },
  CHF: { nom: 'USDCHF', inverse: true, secours: 0.85 },
  CAD: { nom: 'USDCAD', inverse: true, secours: 1.37 },
};

/** Symboles à coter en permanence pour convertir les profits en USD. */
export const SYMBOLES_CONVERSION = Object.values(CONVERSION).map((c) => c.nom);

/** Valeur en USD d'une unité de la devise `devise`, d'après les cotations « milieu » connues. */
export function versUsd(devise: Devise, milieu: (nom: string) => number | undefined): number {
  if (devise === 'USD') return 1;
  const c = CONVERSION[devise];
  const taux = milieu(c.nom) ?? c.secours;
  return c.inverse ? 1 / taux : taux;
}

// ---------- Séances de cotation ----------

/** Le marché du symbole est-il ouvert à l'instant `t` (heures UTC, approximation des séances de CFD) ? */
export function marcheOuvert(s: SymboleMT, t = Date.now()): boolean {
  if (s.categorie === 'crypto') return true;
  const d = new Date(t);
  const jour = d.getUTCDay();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (s.categorie === 'actions-us') return jour >= 1 && jour <= 5 && minutes >= 13 * 60 + 30 && minutes < 20 * 60;
  if (s.categorie === 'actions-fr') return jour >= 1 && jour <= 5 && minutes >= 7 * 60 && minutes < 15 * 60 + 30;
  // Forex, métaux, indices, énergie : du dimanche 22 h au vendredi 21 h (UTC).
  if (jour === 6) return false;
  if (jour === 0) return minutes >= 22 * 60;
  if (jour === 5) return minutes < 21 * 60;
  return true;
}

export function libelleSeances(s: SymboleMT): string {
  if (s.categorie === 'crypto') return '24 h/24, 7 j/7';
  if (s.categorie === 'actions-us') return 'Lundi – vendredi, 13:30 – 20:00 UTC';
  if (s.categorie === 'actions-fr') return 'Lundi – vendredi, 07:00 – 15:30 UTC';
  return 'Dimanche 22:00 – vendredi 21:00 UTC';
}
