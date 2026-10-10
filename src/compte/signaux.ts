/**
 * Signaux (copie de trades), comme le service Signals de MT5, sur les comptes de démonstration en ligne : un compte
 * publie son signal, d'autres s'y abonnent avec un coefficient de volume, et le serveur Parnassa-Trader recopie
 * chaque minute ses nouvelles positions, ses S/L et T/P et ses fermetures, même terminaux fermés.
 * Module pur : utilisé par le serveur (serveur/) et par les tests.
 */
import { fermerPosition, journaliser, modifierPosition, ouvrirMarche, type Compte, type Cotations } from './moteur';
import { symbole } from '../marche/symboles';

export interface Abonnement {
  fournisseur: number;
  /** Coefficient appliqué au volume du fournisseur (0,1 à 10). */
  ratio: number;
  /** Seules les positions ouvertes après l'abonnement sont copiées. */
  depuis: number;
}

export interface StatistiquesSignal {
  croissancePct: number;
  solde: number;
  devise: string;
  trades: number;
  gagnantsPct: number;
  ddMaxPct: number;
  positionsOuvertes: number;
  semaines: number;
  dernierTrade: number | null;
  /** Solde après chaque trade (40 points au plus) pour la petite courbe. */
  courbe: number[];
}

/** Statistiques publiques d'un signal, tirées de l'historique du compte (dépôts exclus). */
export function statistiquesSignal(c: Compte, maintenant = Date.now()): StatistiquesSignal {
  let solde = 0;
  let sommet = 0;
  let ddMax = 0;
  let trades = 0;
  let gagnants = 0;
  // Croissance composée : chaque trade compte pour son rendement sur le solde du moment (les dépôts n'en sont pas).
  let facteur = 1;
  const courbe: number[] = [];
  for (const t of c.transactions) {
    if (t.type === 'balance') {
      solde += t.profit;
      sommet = Math.max(sommet, solde);
      continue;
    }
    const resultat = t.profit + t.commission + t.swap;
    if (t.entree === 'out') {
      trades++;
      if (resultat > 0) gagnants++;
      if (solde > 0) facteur *= 1 + resultat / solde;
    }
    solde += resultat;
    sommet = Math.max(sommet, solde);
    if (sommet > 0) ddMax = Math.max(ddMax, ((sommet - solde) / sommet) * 100);
    if (t.entree === 'out') courbe.push(Math.round(solde * 100) / 100);
  }
  const fermes = c.transactions.filter((t) => t.entree === 'out');
  return {
    croissancePct: Math.round((facteur - 1) * 10000) / 100,
    solde: Math.round(c.solde * 100) / 100,
    devise: c.devise ?? 'USD',
    trades,
    gagnantsPct: trades ? Math.round((gagnants / trades) * 1000) / 10 : 0,
    ddMaxPct: Math.round(ddMax * 100) / 100,
    positionsOuvertes: c.positions.length,
    semaines: Math.max(0, Math.floor((maintenant - c.creeLe) / (7 * 86400000))),
    dernierTrade: fermes.length ? fermes[fermes.length - 1].heure : null,
    courbe: courbe.length > 40 ? courbe.filter((_, k) => k % Math.ceil(courbe.length / 40) === 0 || k === courbe.length - 1) : courbe,
  };
}

/** Commentaire qui relie une position copiée à celle du fournisseur. */
export const marqueSignal = (fournisseur: number, ticket: number) => `signal ${fournisseur}#${ticket}`;
const LIRE_MARQUE = /^signal (\d+)#(\d+)$/;

/** Fenêtre de copie : une position du fournisseur plus ancienne n'est plus recopiée (comme MT5, pas de rattrapage). */
export const FENETRE_COPIE = 10 * 60000;

/**
 * Recopie le fournisseur sur l'abonné : ouvre ses nouvelles positions (volume × coefficient), aligne les S/L et T/P,
 * ferme les copies dont l'original est fermé. Renvoie le compte de l'abonné, les messages et s'il a changé.
 */
export function copierSignal(abonne: Compte, fournisseur: Compte, a: Abonnement, cot: Cotations, maintenant = Date.now()): { compte: Compte; messages: string[]; modifie: boolean } {
  let c = abonne;
  const messages: string[] = [];
  const copies = new Map<number, number>();
  for (const p of c.positions) {
    const m = LIRE_MARQUE.exec(p.commentaire);
    if (m && Number(m[1]) === a.fournisseur) copies.set(Number(m[2]), p.ticket);
  }
  const dejaCopiees = new Set(c.transactions.filter((t) => t.commentaire.startsWith(`signal ${a.fournisseur}#`)).map((t) => Number(LIRE_MARQUE.exec(t.commentaire)?.[2])));
  const ouvertes = new Set(fournisseur.positions.map((p) => p.ticket));

  // Fermetures : l'original n'existe plus.
  for (const [original, ticket] of copies) {
    if (ouvertes.has(original)) continue;
    const r = fermerPosition(c, ticket, cot, undefined, 'signal');
    if (r.erreur) continue;
    c = r.compte;
    messages.push(`Signal ${a.fournisseur} : position #${ticket} fermée comme l'originale`);
  }
  for (const p of fournisseur.positions) {
    const copie = copies.get(p.ticket);
    if (copie !== undefined) {
      // S/L et T/P suivis.
      const x = c.positions.find((k) => k.ticket === copie);
      if (x && (x.sl !== p.sl || x.tp !== p.tp)) {
        const r = modifierPosition(c, copie, p.sl, p.tp, cot);
        if (!r.erreur) c = r.compte;
      }
      continue;
    }
    if (p.heure < a.depuis || maintenant - p.heure > FENETRE_COPIE || dejaCopiees.has(p.ticket)) continue;
    const s = symbole(p.symbole);
    if (!s || !cot[p.symbole]) continue;
    const volume = Number(Math.min(s.volumeMax, Math.max(s.volumeMin, Math.round((p.volume * a.ratio) / s.pasVolume) * s.pasVolume)).toFixed(2));
    const r = ouvrirMarche(c, { symbole: p.symbole, type: p.type, volume, sl: p.sl, tp: p.tp, commentaire: marqueSignal(a.fournisseur, p.ticket) }, cot);
    if (r.erreur) {
      // Noté une seule fois dans le journal de l'abonné (la copie est retentée tant que la fenêtre est ouverte).
      const texte = `Signal ${a.fournisseur} : copie de ${p.type} ${p.symbole} (#${p.ticket}) refusée — ${r.erreur}`;
      if (!c.journal.some((j) => j.message === texte)) {
        c = journaliser(c, 'Trades', texte);
        messages.push(texte);
      }
      continue;
    }
    c = r.compte;
    messages.push(`Signal ${a.fournisseur} : ${p.type} ${volume.toFixed(2)} ${p.symbole} copié`);
  }
  return { compte: c, messages, modifie: c !== abonne };
}
