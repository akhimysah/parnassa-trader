/**
 * Moteur d'un compte de démonstration façon MetaTrader 5, en mode « couverture » (hedging) :
 * chaque ordre au marché ouvre une position distincte. Achat au prix Ask, vente au prix Bid ;
 * une position acheteuse se ferme au Bid, une position vendeuse à l'Ask.
 */
import type { Cotation } from '../marche/cotations';
import { commissionParCote, formaterPrix, marcheOuvert, point, rolloversEntre, swapPoints, symbole, versUsd, type SymboleMT, type TypeCompte } from '../marche/symboles';

export type Sens = 'buy' | 'sell';
export type TypeEnAttente = 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'buy_stop_limit' | 'sell_stop_limit';
export type Expiration = 'gtc' | 'jour' | 'date';

export interface Position {
  ticket: number;
  symbole: string;
  type: Sens;
  volume: number;
  prixOuverture: number;
  /** 0 = pas de stop-loss / take-profit, comme dans MT5. */
  sl: number;
  tp: number;
  heure: number;
  /** Commission payée à l'ouverture (négative, déjà retirée du solde comme dans MT5 : pour l'affichage). */
  commission: number;
  swap: number;
  commentaire: string;
  /** Stop suiveur, en points (0 = désactivé). */
  suiveur: number;
  /** Identifiant de l'Expert Advisor qui a ouvert la position (0 = manuelle). */
  magic?: number;
  /** Dernier rollover dont le swap a été compté (ms) ; à défaut, l'heure d'ouverture. */
  dernierSwap?: number;
}

export interface Ordre {
  ticket: number;
  symbole: string;
  type: TypeEnAttente;
  volume: number;
  prix: number;
  /** Prix de l'ordre limite placé quand un ordre Buy/Sell Stop Limit se déclenche. */
  prixLimite: number;
  sl: number;
  tp: number;
  heure: number;
  expiration: Expiration;
  /** Échéance (ms) si `expiration` vaut « date ». */
  echeance: number;
  commentaire: string;
}

export interface Transaction {
  ticket: number;
  ordre: number;
  position: number;
  heure: number;
  symbole: string;
  type: Sens | 'balance';
  entree: 'in' | 'out' | '';
  volume: number;
  prix: number;
  commission: number;
  swap: number;
  profit: number;
  solde: number;
  commentaire: string;
  /** Sur les transactions de sortie : prix d'ouverture, heure d'ouverture et stops de la position fermée. */
  prixOuverture?: number;
  heureOuverture?: number;
  sl?: number;
  tp?: number;
}

export type EtatOrdre = 'rempli' | 'annulé' | 'expiré' | 'rejeté';

export interface OrdreHistorique {
  ticket: number;
  heure: number;
  heureFin: number;
  symbole: string;
  type: Sens | TypeEnAttente;
  volume: number;
  prix: number;
  sl: number;
  tp: number;
  etat: EtatOrdre;
  commentaire: string;
}

export interface EntreeJournal {
  heure: number;
  source: 'Réseau' | 'Trades' | 'Terminal' | 'Alertes' | 'Experts';
  message: string;
}

export interface Compte {
  login: number;
  nom: string;
  /** Standard (spreads larges, sans commission) ou Raw (spreads serrés + commission) ; Standard si absent. */
  type?: TypeCompte;
  /** Compte sans swap (« islamique ») : aucun swap n'est débité ni crédité. */
  sansSwap?: boolean;
  serveur: string;
  devise: 'USD';
  levier: number;
  solde: number;
  credit: number;
  positions: Position[];
  ordres: Ordre[];
  transactions: Transaction[];
  ordresHisto: OrdreHistorique[];
  journal: EntreeJournal[];
  ticketSuivant: number;
  creeLe: number;
  /** Vrai tant que le niveau de marge est sous le seuil d'appel de marge (évite de répéter l'avertissement). */
  appelMarge: boolean;
}

export const NIVEAU_APPEL_MARGE = 100;
export const NIVEAU_STOP_OUT = 50;
export const SERVEUR = 'Parnassa-Demo';

export const LIBELLES_TYPE: Record<Sens | TypeEnAttente | 'balance', string> = {
  buy: 'buy',
  sell: 'sell',
  buy_limit: 'buy limit',
  sell_limit: 'sell limit',
  buy_stop: 'buy stop',
  sell_stop: 'sell stop',
  buy_stop_limit: 'buy stop limit',
  sell_stop_limit: 'sell stop limit',
  balance: 'balance',
};

export const NOMS_TYPE_ATTENTE: Record<TypeEnAttente, string> = {
  buy_limit: 'Buy Limit',
  sell_limit: 'Sell Limit',
  buy_stop: 'Buy Stop',
  sell_stop: 'Sell Stop',
  buy_stop_limit: 'Buy Stop Limit',
  sell_stop_limit: 'Sell Stop Limit',
};

export type Cotations = Record<string, Cotation>;

export function sensDe(type: Sens | TypeEnAttente): Sens {
  return type.startsWith('buy') ? 'buy' : 'sell';
}

function milieuDe(cot: Cotations) {
  return (nom: string) => {
    const c = cot[nom];
    return c ? (c.bid + c.ask) / 2 : undefined;
  };
}

/** Valeur en USD d'une unité de la devise de profit du symbole. */
export function conversion(s: SymboleMT, cot: Cotations): number {
  return versUsd(s.profit, milieuDe(cot));
}

export function levierEffectif(s: SymboleMT, levierCompte: number): number {
  return Math.max(1, Math.min(levierCompte, s.levierMax));
}

/** Marge requise (USD) pour `volume` lots au prix `prix`. */
export function margeRequise(s: SymboleMT, volume: number, prix: number, levierCompte: number, cot: Cotations): number {
  return (volume * s.contrat * prix * conversion(s, cot)) / levierEffectif(s, levierCompte);
}

/** Prix de clôture d'une position : Bid pour un achat, Ask pour une vente. */
export function prixFermeture(type: Sens, c: Cotation): number {
  return type === 'buy' ? c.bid : c.ask;
}

export function profitPosition(p: Position, cot: Cotations): number {
  const s = symbole(p.symbole);
  const c = cot[p.symbole];
  if (!s || !c) return 0;
  const ecart = p.type === 'buy' ? c.bid - p.prixOuverture : p.prixOuverture - c.ask;
  return ecart * p.volume * s.contrat * conversion(s, cot);
}

export interface EtatCompte {
  solde: number;
  credit: number;
  profit: number;
  fondsPropres: number;
  marge: number;
  margeLibre: number;
  /** En %, null sans marge utilisée. */
  niveauMarge: number | null;
}

export function etatCompte(c: Compte, cot: Cotations): EtatCompte {
  let profit = 0;
  let marge = 0;
  for (const p of c.positions) {
    const s = symbole(p.symbole);
    if (!s) continue;
    profit += profitPosition(p, cot) + p.swap;
    marge += margeRequise(s, p.volume, p.prixOuverture, c.levier, cot);
  }
  const fondsPropres = c.solde + c.credit + profit;
  return {
    solde: c.solde,
    credit: c.credit,
    profit,
    fondsPropres,
    marge,
    margeLibre: fondsPropres - marge,
    niveauMarge: marge > 0 ? (fondsPropres / marge) * 100 : null,
  };
}

// ---------- Création ----------

export function nouveauCompte(nom: string, depot: number, levier: number, type: TypeCompte = 'standard', sansSwap = false): Compte {
  const login = 50000000 + Math.floor(Math.random() * 49999999);
  const maintenant = Date.now();
  const ticket = 100000000 + Math.floor(Math.random() * 9000000);
  return {
    login,
    nom,
    type,
    sansSwap: sansSwap || undefined,
    serveur: SERVEUR,
    devise: 'USD',
    levier,
    solde: depot,
    credit: 0,
    positions: [],
    ordres: [],
    transactions: [
      { ticket, ordre: 0, position: 0, heure: maintenant, symbole: '', type: 'balance', entree: '', volume: 0, prix: 0, commission: 0, swap: 0, profit: depot, solde: depot, commentaire: 'Dépôt de démonstration' },
    ],
    ordresHisto: [],
    journal: [{ heure: maintenant, source: 'Réseau', message: `'${login}' : compte de démonstration ouvert sur ${SERVEUR}, dépôt ${depot.toFixed(2)} USD, levier 1:${levier}, compte ${type === 'raw' ? 'Raw' : 'Standard'}${sansSwap ? ' sans swap' : ''}` }],
    ticketSuivant: ticket + 1,
    creeLe: maintenant,
    appelMarge: false,
  };
}

export function journaliser(c: Compte, source: EntreeJournal['source'], message: string): Compte {
  return { ...c, journal: [...c.journal, { heure: Date.now(), source, message }].slice(-1000) };
}

function arrondir(v: number, chiffres = 2): number {
  return Number(v.toFixed(chiffres));
}

export function fmtVolume(v: number): string {
  return v.toFixed(2);
}

// ---------- Vérifications ----------

export interface Resultat {
  compte: Compte;
  /** Message d'erreur façon code retour MT5 (null si l'opération a réussi). */
  erreur: string | null;
  /** Description de l'opération réalisée, pour la fenêtre de confirmation. */
  message?: string;
  ticket?: number;
}

function echec(c: Compte, erreur: string, demande: string): Resultat {
  return { compte: journaliser(c, 'Trades', `'${c.login}' : ${demande} — échec [${erreur}]`), erreur };
}

export function verifierVolume(s: SymboleMT, volume: number): string | null {
  if (!(volume >= s.volumeMin - 1e-9) || volume > s.volumeMax + 1e-9) return 'Volume invalide';
  const pas = Math.round(volume / s.pasVolume);
  if (Math.abs(pas * s.pasVolume - volume) > 1e-9) return 'Volume invalide';
  return null;
}

/** Le stop-loss et le take-profit doivent encadrer `prix` du bon côté (0 = aucun). */
export function verifierStops(sens: Sens, prix: number, sl: number, tp: number): string | null {
  if (sl < 0 || tp < 0) return 'Stops invalides';
  if (sens === 'buy') {
    if (sl > 0 && sl >= prix) return 'Stops invalides';
    if (tp > 0 && tp <= prix) return 'Stops invalides';
  } else {
    if (sl > 0 && sl <= prix) return 'Stops invalides';
    if (tp > 0 && tp >= prix) return 'Stops invalides';
  }
  return null;
}

// ---------- Ordres au marché ----------

export interface DemandeMarche {
  symbole: string;
  type: Sens;
  volume: number;
  sl: number;
  tp: number;
  commentaire: string;
  magic?: number;
}

function decrireDemande(d: { type: string; volume: number; symbole: string; sl: number; tp: number }, s: SymboleMT | undefined, prix?: number): string {
  const f = (v: number) => formaterPrix(s, v);
  return `${d.type} ${fmtVolume(d.volume)} ${d.symbole}${prix ? ` à ${f(prix)}` : ''}${d.sl ? ` sl : ${f(d.sl)}` : ''}${d.tp ? ` tp : ${f(d.tp)}` : ''}`;
}

/** Ouvre une position au marché (achat à l'Ask, vente au Bid). */
export function ouvrirMarche(c: Compte, d: DemandeMarche, cot: Cotations, origine?: { ordre: number; heureOrdre: number; type: TypeEnAttente }): Resultat {
  const s = symbole(d.symbole);
  const q = cot[d.symbole];
  const demande = origine ? `déclenchement de l'ordre #${origine.ordre} ${decrireDemande({ ...d, type: LIBELLES_TYPE[origine.type] }, s)}` : `${d.type === 'buy' ? 'achat' : 'vente'} au marché ${decrireDemande(d, s)}`;
  if (!s) return echec(c, 'Symbole inconnu', demande);
  if (!q) return echec(c, 'Pas de cotation', demande);
  if (!marcheOuvert(s)) return echec(c, 'Marché fermé', demande);
  const ev = verifierVolume(s, d.volume);
  if (ev) return echec(c, ev, demande);
  const prix = d.type === 'buy' ? q.ask : q.bid;
  // Les stops sont contrôlés par rapport au prix de clôture (Bid pour un achat, Ask pour une vente).
  const es = verifierStops(d.type, prixFermeture(d.type, q), d.sl, d.tp);
  if (es) return echec(c, es, demande);
  const marge = margeRequise(s, d.volume, prix, c.levier, cot);
  const etat = etatCompte(c, cot);
  const commission = -arrondir(commissionParCote(s, c.type ?? 'standard', d.volume, d.volume * s.contrat * prix * conversion(s, cot))) || 0;
  if (marge - commission > etat.margeLibre) return echec(c, 'Pas assez d\'argent', demande);

  const ticketOrdre = origine?.ordre ?? c.ticketSuivant;
  const ticketDeal = origine ? c.ticketSuivant : c.ticketSuivant + 1;
  const maintenant = Date.now();
  const position: Position = {
    ticket: ticketOrdre,
    symbole: d.symbole,
    type: d.type,
    volume: d.volume,
    prixOuverture: prix,
    sl: d.sl,
    tp: d.tp,
    heure: maintenant,
    commission,
    swap: 0,
    commentaire: d.commentaire,
    suiveur: 0,
    magic: d.magic,
  };
  const deal: Transaction = {
    ticket: ticketDeal,
    ordre: ticketOrdre,
    position: ticketOrdre,
    heure: maintenant,
    symbole: d.symbole,
    type: d.type,
    entree: 'in',
    volume: d.volume,
    prix,
    commission,
    swap: 0,
    profit: 0,
    solde: arrondir(c.solde + commission),
    commentaire: d.commentaire,
  };
  const histo: OrdreHistorique = {
    ticket: ticketOrdre,
    heure: origine?.heureOrdre ?? maintenant,
    heureFin: maintenant,
    symbole: d.symbole,
    type: origine?.type ?? d.type,
    volume: d.volume,
    prix,
    sl: d.sl,
    tp: d.tp,
    etat: 'rempli',
    commentaire: d.commentaire,
  };
  const suite: Compte = {
    ...c,
    solde: arrondir(c.solde + commission),
    positions: [...c.positions, position],
    transactions: [...c.transactions, deal],
    ordresHisto: [...c.ordresHisto, histo],
    ticketSuivant: ticketDeal + 1,
  };
  const message = `${d.type} ${fmtVolume(d.volume)} ${d.symbole} à ${formaterPrix(s, prix)}`;
  return {
    compte: journaliser(suite, 'Trades', `'${c.login}' : ${demande} — exécuté, deal #${ticketDeal} ${message}`),
    erreur: null,
    message,
    ticket: ticketOrdre,
  };
}

// ---------- Ordres en attente ----------

export interface DemandeAttente {
  symbole: string;
  type: TypeEnAttente;
  volume: number;
  prix: number;
  prixLimite: number;
  sl: number;
  tp: number;
  expiration: Expiration;
  echeance: number;
  commentaire: string;
}

/** Contrôle la position du prix d'un ordre en attente par rapport au marché. */
export function verifierPrixAttente(type: TypeEnAttente, prix: number, prixLimite: number, q: Cotation): string | null {
  if (!(prix > 0)) return 'Prix invalide';
  switch (type) {
    case 'buy_limit':
      return prix < q.ask ? null : 'Prix invalide';
    case 'sell_limit':
      return prix > q.bid ? null : 'Prix invalide';
    case 'buy_stop':
      return prix > q.ask ? null : 'Prix invalide';
    case 'sell_stop':
      return prix < q.bid ? null : 'Prix invalide';
    case 'buy_stop_limit':
      return prix > q.ask && prixLimite > 0 && prixLimite < prix ? null : 'Prix invalide';
    case 'sell_stop_limit':
      return prix < q.bid && prixLimite > 0 && prixLimite > prix ? null : 'Prix invalide';
  }
}

export function placerOrdre(c: Compte, d: DemandeAttente, cot: Cotations): Resultat {
  const s = symbole(d.symbole);
  const q = cot[d.symbole];
  const demande = `${LIBELLES_TYPE[d.type]} ${decrireDemande({ ...d, type: '' }, s, d.prix).trim()}`;
  if (!s) return echec(c, 'Symbole inconnu', demande);
  if (!q) return echec(c, 'Pas de cotation', demande);
  if (!marcheOuvert(s)) return echec(c, 'Marché fermé', demande);
  const ev = verifierVolume(s, d.volume);
  if (ev) return echec(c, ev, demande);
  const ep = verifierPrixAttente(d.type, d.prix, d.prixLimite, q);
  if (ep) return echec(c, ep, demande);
  const prixExecution = d.type.endsWith('stop_limit') ? d.prixLimite : d.prix;
  const es = verifierStops(sensDe(d.type), prixExecution, d.sl, d.tp);
  if (es) return echec(c, es, demande);
  if (d.expiration === 'date' && !(d.echeance > Date.now())) return echec(c, 'Expiration invalide', demande);
  const ordre: Ordre = {
    ticket: c.ticketSuivant,
    symbole: d.symbole,
    type: d.type,
    volume: d.volume,
    prix: d.prix,
    prixLimite: d.type.endsWith('stop_limit') ? d.prixLimite : 0,
    sl: d.sl,
    tp: d.tp,
    heure: Date.now(),
    expiration: d.expiration,
    echeance: d.expiration === 'date' ? d.echeance : 0,
    commentaire: d.commentaire,
  };
  const suite = { ...c, ordres: [...c.ordres, ordre], ticketSuivant: c.ticketSuivant + 1 };
  return {
    compte: journaliser(suite, 'Trades', `'${c.login}' : ${demande} — placé, ordre #${ordre.ticket}`),
    erreur: null,
    message: `${LIBELLES_TYPE[d.type]} ${fmtVolume(d.volume)} ${d.symbole} à ${formaterPrix(s, d.prix)}`,
    ticket: ordre.ticket,
  };
}

function archiverOrdre(c: Compte, o: Ordre, etat: EtatOrdre): Compte {
  const histo: OrdreHistorique = { ticket: o.ticket, heure: o.heure, heureFin: Date.now(), symbole: o.symbole, type: o.type, volume: o.volume, prix: o.prix, sl: o.sl, tp: o.tp, etat, commentaire: o.commentaire };
  return { ...c, ordres: c.ordres.filter((x) => x.ticket !== o.ticket), ordresHisto: [...c.ordresHisto, histo] };
}

export function supprimerOrdre(c: Compte, ticket: number): Resultat {
  const o = c.ordres.find((x) => x.ticket === ticket);
  if (!o) return { compte: c, erreur: 'Ordre introuvable' };
  return { compte: journaliser(archiverOrdre(c, o, 'annulé'), 'Trades', `'${c.login}' : suppression de l'ordre #${ticket} ${LIBELLES_TYPE[o.type]} ${fmtVolume(o.volume)} ${o.symbole} — effectuée`), erreur: null };
}

export function modifierOrdre(c: Compte, ticket: number, m: { prix: number; prixLimite: number; sl: number; tp: number; expiration: Expiration; echeance: number }, cot: Cotations): Resultat {
  const o = c.ordres.find((x) => x.ticket === ticket);
  if (!o) return { compte: c, erreur: 'Ordre introuvable' };
  const q = cot[o.symbole];
  const s = symbole(o.symbole);
  const demande = `modification de l'ordre #${ticket} ${LIBELLES_TYPE[o.type]} ${o.symbole} à ${formaterPrix(s, m.prix)}`;
  if (!q) return echec(c, 'Pas de cotation', demande);
  const ep = verifierPrixAttente(o.type, m.prix, m.prixLimite, q);
  if (ep) return echec(c, ep, demande);
  const es = verifierStops(sensDe(o.type), o.type.endsWith('stop_limit') ? m.prixLimite : m.prix, m.sl, m.tp);
  if (es) return echec(c, es, demande);
  const ordres = c.ordres.map((x) => (x.ticket === ticket ? { ...x, ...m, echeance: m.expiration === 'date' ? m.echeance : 0 } : x));
  return { compte: journaliser({ ...c, ordres }, 'Trades', `'${c.login}' : ${demande} — effectuée`), erreur: null };
}

// ---------- Positions ----------

export function modifierPosition(c: Compte, ticket: number, sl: number, tp: number, cot: Cotations): Resultat {
  const p = c.positions.find((x) => x.ticket === ticket);
  if (!p) return { compte: c, erreur: 'Position introuvable' };
  const q = cot[p.symbole];
  const s = symbole(p.symbole);
  const demande = `modification de la position #${ticket} ${p.type} ${fmtVolume(p.volume)} ${p.symbole} sl : ${formaterPrix(s, sl)}, tp : ${formaterPrix(s, tp)}`;
  if (!q) return echec(c, 'Pas de cotation', demande);
  const es = verifierStops(p.type, prixFermeture(p.type, q), sl, tp);
  if (es) return echec(c, es, demande);
  const positions = c.positions.map((x) => (x.ticket === ticket ? { ...x, sl, tp } : x));
  return { compte: journaliser({ ...c, positions }, 'Trades', `'${c.login}' : ${demande} — effectuée`), erreur: null };
}

export function definirSuiveur(c: Compte, ticket: number, points: number): Compte {
  const positions = c.positions.map((x) => (x.ticket === ticket ? { ...x, suiveur: points } : x));
  return journaliser({ ...c, positions }, 'Trades', `'${c.login}' : stop suiveur ${points > 0 ? `de ${points} points` : 'désactivé'} sur la position #${ticket}`);
}

/** Ferme tout ou partie (`volume`) d'une position au prix du marché. */
export function fermerPosition(c: Compte, ticket: number, cot: Cotations, volume?: number, raison?: string): Resultat {
  const p = c.positions.find((x) => x.ticket === ticket);
  if (!p) return { compte: c, erreur: 'Position introuvable' };
  const s = symbole(p.symbole);
  const q = cot[p.symbole];
  const v = Math.min(p.volume, volume ?? p.volume);
  const demande = `${raison ? `${raison} ` : ''}fermeture de la position #${ticket} ${p.type} ${fmtVolume(v)} ${p.symbole}`;
  if (!s) return echec(c, 'Symbole inconnu', demande);
  if (!q) return echec(c, 'Pas de cotation', demande);
  if (!raison && !marcheOuvert(s)) return echec(c, 'Marché fermé', demande);
  if (!(v > 0) || (v < p.volume && verifierVolume(s, v))) return echec(c, 'Volume invalide', demande);
  const prix = prixFermeture(p.type, q);
  const part = v / p.volume;
  const ecart = p.type === 'buy' ? prix - p.prixOuverture : p.prixOuverture - prix;
  const profit = arrondir(ecart * v * s.contrat * conversion(s, cot));
  const swap = arrondir(p.swap * part);
  // Commission de sortie (compte Raw) ; celle d'entrée a déjà été prélevée à l'ouverture.
  const commission = -arrondir(commissionParCote(s, c.type ?? 'standard', v, v * s.contrat * prix * conversion(s, cot))) || 0;
  const commissionEntree = arrondir(p.commission * part);
  const solde = arrondir(c.solde + profit + swap + commission);
  const maintenant = Date.now();
  const ticketOrdre = c.ticketSuivant;
  const deal: Transaction = {
    ticket: c.ticketSuivant + 1,
    ordre: ticketOrdre,
    position: p.ticket,
    heure: maintenant,
    symbole: p.symbole,
    type: p.type === 'buy' ? 'sell' : 'buy',
    entree: 'out',
    volume: v,
    prix,
    commission,
    swap,
    profit,
    solde,
    commentaire: raison ? `[${raison}]` : p.commentaire,
    prixOuverture: p.prixOuverture,
    heureOuverture: p.heure,
    sl: p.sl,
    tp: p.tp,
  };
  const histo: OrdreHistorique = {
    ticket: ticketOrdre,
    heure: maintenant,
    heureFin: maintenant,
    symbole: p.symbole,
    type: deal.type as Sens,
    volume: v,
    prix,
    sl: 0,
    tp: 0,
    etat: 'rempli',
    commentaire: deal.commentaire,
  };
  const reste = arrondir(p.volume - v, 4);
  const positions =
    reste <= 1e-9
      ? c.positions.filter((x) => x.ticket !== ticket)
      : c.positions.map((x) => (x.ticket === ticket ? { ...x, volume: reste, swap: x.swap - swap, commission: x.commission - commissionEntree } : x));
  const suite: Compte = { ...c, solde, positions, transactions: [...c.transactions, deal], ordresHisto: [...c.ordresHisto, histo], ticketSuivant: c.ticketSuivant + 2 };
  const message = `${deal.type} ${fmtVolume(v)} ${p.symbole} à ${formaterPrix(s, prix)}, profit ${profit.toFixed(2)} USD`;
  return { compte: journaliser(suite, 'Trades', `'${c.login}' : ${demande} — exécuté, deal #${deal.ticket} ${message}`), erreur: null, message };
}

/** Dépôt ou retrait de démonstration (opération de balance). */
export function operationBalance(c: Compte, montant: number, commentaire: string): Resultat {
  if (!Number.isFinite(montant) || montant === 0) return { compte: c, erreur: 'Montant invalide' };
  if (montant < 0 && -montant > c.solde) return { compte: c, erreur: 'Pas assez d\'argent' };
  const solde = arrondir(c.solde + montant);
  const deal: Transaction = { ticket: c.ticketSuivant, ordre: 0, position: 0, heure: Date.now(), symbole: '', type: 'balance', entree: '', volume: 0, prix: 0, commission: 0, swap: 0, profit: montant, solde, commentaire };
  return {
    compte: journaliser({ ...c, solde, transactions: [...c.transactions, deal], ticketSuivant: c.ticketSuivant + 1 }, 'Trades', `'${c.login}' : ${commentaire} ${montant.toFixed(2)} USD`),
    erreur: null,
  };
}

// ---------- Tick : déclenchements, stops, stop-out ----------

function declenche(o: Ordre, q: Cotation): boolean {
  switch (o.type) {
    case 'buy_limit':
      return q.ask <= o.prix;
    case 'sell_limit':
      return q.bid >= o.prix;
    case 'buy_stop':
    case 'buy_stop_limit':
      return q.ask >= o.prix;
    case 'sell_stop':
    case 'sell_stop_limit':
      return q.bid <= o.prix;
  }
}

function finDeJournee(heure: number): number {
  const d = new Date(heure);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59);
}

/**
 * Swaps : à chaque rollover (22:00 UTC, triple le mercredi ou le vendredi selon le symbole) passé depuis le dernier
 * compté, la position est débitée ou créditée du swap long / short. Les nuits manquées (application fermée) sont
 * rattrapées. Le swap s'ajoute au profit flottant et passe au solde à la fermeture, comme dans MT5.
 */
export function appliquerSwaps(c: Compte, cot: Cotations, maintenant = Date.now()): Compte {
  if (c.sansSwap) return c;
  let change = false;
  const positions = c.positions.map((p) => {
    const s = symbole(p.symbole);
    if (!s) return p;
    const nuits = rolloversEntre(s, p.dernierSwap ?? p.heure, maintenant);
    if (nuits.length === 0) return p;
    const q = cot[p.symbole];
    const prix = q ? (q.bid + q.ask) / 2 : p.prixOuverture;
    const points = swapPoints(s, prix)[p.type === 'buy' ? 'long' : 'short'];
    const fois = nuits.reduce((t, n) => t + n.fois, 0);
    const montant = fois * points * point(s) * s.contrat * p.volume * conversion(s, cot);
    change = true;
    return { ...p, swap: arrondir(p.swap + montant), dernierSwap: nuits[nuits.length - 1].t };
  });
  return change ? { ...c, positions } : c;
}

export interface Evenement {
  type: 'execution' | 'sl' | 'tp' | 'stop-out' | 'appel-marge' | 'expiration' | 'rejet';
  message: string;
}

/**
 * Applique les nouvelles cotations au compte : expiration et déclenchement des ordres en attente,
 * stops suiveurs, stop-loss / take-profit, appel de marge et stop-out (fermeture de la position la plus perdante
 * jusqu'à repasser au-dessus du seuil, comme MT5).
 */
export function appliquerCotations(c: Compte, cot: Cotations): { compte: Compte; evenements: Evenement[] } {
  let courant = appliquerSwaps(c, cot);
  const evenements: Evenement[] = [];
  const maintenant = Date.now();

  for (const o of c.ordres) {
    const q = cot[o.symbole];
    const s = symbole(o.symbole);
    if (!s) continue;
    const echu = (o.expiration === 'jour' && maintenant > finDeJournee(o.heure)) || (o.expiration === 'date' && maintenant > o.echeance);
    if (echu) {
      courant = journaliser(archiverOrdre(courant, o, 'expiré'), 'Trades', `'${c.login}' : ordre #${o.ticket} ${LIBELLES_TYPE[o.type]} ${o.symbole} expiré`);
      evenements.push({ type: 'expiration', message: `Ordre #${o.ticket} ${LIBELLES_TYPE[o.type]} ${o.symbole} expiré` });
      continue;
    }
    if (!q || !marcheOuvert(s) || !declenche(o, q)) continue;
    if (o.type.endsWith('stop_limit')) {
      // Le stop est atteint : l'ordre devient un ordre limite au prix prévu.
      const type: TypeEnAttente = o.type === 'buy_stop_limit' ? 'buy_limit' : 'sell_limit';
      const ordres = courant.ordres.map((x) => (x.ticket === o.ticket ? { ...x, type, prix: o.prixLimite, prixLimite: 0 } : x));
      courant = journaliser({ ...courant, ordres }, 'Trades', `'${c.login}' : ordre #${o.ticket} ${LIBELLES_TYPE[o.type]} déclenché, ${LIBELLES_TYPE[type]} placé à ${formaterPrix(s, o.prixLimite)}`);
      continue;
    }
    const r = ouvrirMarche(courant, { symbole: o.symbole, type: sensDe(o.type), volume: o.volume, sl: o.sl, tp: o.tp, commentaire: o.commentaire }, cot, { ordre: o.ticket, heureOrdre: o.heure, type: o.type });
    if (r.erreur) {
      courant = archiverOrdre(r.compte, o, 'rejeté');
      evenements.push({ type: 'rejet', message: `Ordre #${o.ticket} ${o.symbole} rejeté : ${r.erreur}` });
    } else {
      courant = { ...r.compte, ordres: r.compte.ordres.filter((x) => x.ticket !== o.ticket) };
      evenements.push({ type: 'execution', message: `Ordre #${o.ticket} exécuté : ${r.message}` });
    }
  }

  for (const p of courant.positions) {
    const q = cot[p.symbole];
    const s = symbole(p.symbole);
    if (!q || !s) continue;
    const prix = prixFermeture(p.type, q);
    // Stop suiveur : le stop-loss suit le prix dès que la position gagne plus que la distance choisie.
    if (p.suiveur > 0) {
      const distance = p.suiveur * point(s);
      const enGain = p.type === 'buy' ? prix - p.prixOuverture : p.prixOuverture - prix;
      if (enGain > distance) {
        const cible = Number((p.type === 'buy' ? prix - distance : prix + distance).toFixed(s.chiffres));
        const meilleur = p.type === 'buy' ? cible > p.sl : p.sl === 0 || cible < p.sl;
        if (meilleur) courant = { ...courant, positions: courant.positions.map((x) => (x.ticket === p.ticket ? { ...x, sl: cible } : x)) };
      }
    }
    const actuelle = courant.positions.find((x) => x.ticket === p.ticket)!;
    const sl = actuelle.sl > 0 && (p.type === 'buy' ? prix <= actuelle.sl : prix >= actuelle.sl);
    const tp = actuelle.tp > 0 && (p.type === 'buy' ? prix >= actuelle.tp : prix <= actuelle.tp);
    if (!sl && !tp) continue;
    const r = fermerPosition(courant, p.ticket, cot, undefined, sl ? 'sl' : 'tp');
    if (r.erreur) continue;
    courant = r.compte;
    evenements.push({ type: sl ? 'sl' : 'tp', message: `${sl ? 'Stop Loss' : 'Take Profit'} #${p.ticket} : ${r.message}` });
  }

  // Appel de marge et stop-out (uniquement si toutes les positions sont cotées).
  if (courant.positions.every((p) => cot[p.symbole])) {
    let etat = etatCompte(courant, cot);
    while (etat.niveauMarge !== null && etat.niveauMarge < NIVEAU_STOP_OUT && courant.positions.length > 0) {
      const pire = courant.positions.reduce((a, b) => (profitPosition(b, cot) < profitPosition(a, cot) ? b : a));
      const niveau = etat.niveauMarge.toFixed(2);
      const r = fermerPosition(courant, pire.ticket, cot, undefined, `so: ${niveau}%/${etat.fondsPropres.toFixed(2)}/${etat.marge.toFixed(2)}`);
      if (r.erreur) break;
      courant = r.compte;
      evenements.push({ type: 'stop-out', message: `Stop-out (niveau de marge ${niveau} %) : position #${pire.ticket} fermée` });
      etat = etatCompte(courant, cot);
    }
    const sousAppel = etat.niveauMarge !== null && etat.niveauMarge < NIVEAU_APPEL_MARGE;
    if (sousAppel && !courant.appelMarge) {
      courant = journaliser({ ...courant, appelMarge: true }, 'Trades', `'${c.login}' : appel de marge, niveau ${etat.niveauMarge!.toFixed(2)} %`);
      evenements.push({ type: 'appel-marge', message: `Appel de marge : niveau ${etat.niveauMarge!.toFixed(2)} %` });
    } else if (!sousAppel && courant.appelMarge) courant = { ...courant, appelMarge: false };
  }

  return { compte: courant, evenements };
}
