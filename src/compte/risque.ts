import { etatCompte, fermerPosition, journaliser, type Compte } from './moteur';
import type { Cotation } from '../marche/cotations';

/**
 * Garde-fous de risque (comme les règles des comptes financés) : perte du jour maximale, nombre de positions et
 * volume par position. 0 désactive une règle. Au-delà de la perte du jour, les nouveaux ordres sont refusés jusqu'au
 * lendemain, et les positions peuvent être fermées d'office.
 */
export interface ReglesRisque {
  perteJourPct: number;
  maxPositions: number;
  maxVolume: number;
  fermerAuSeuil: boolean;
}

export const RISQUE_DEFAUT: ReglesRisque = { perteJourPct: 0, maxPositions: 0, maxVolume: 0, fermerAuSeuil: false };

const debutJour = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Solde au début de la journée (heure locale) : solde actuel moins le résultat des trades fermés aujourd'hui. */
export function soldeDebutJour(c: Compte): number {
  const depuis = debutJour();
  const jour = c.transactions.filter((t) => t.heure >= depuis && t.type !== 'balance').reduce((s, t) => s + t.profit + t.swap + t.commission, 0);
  return c.solde - jour;
}

/** Perte du jour en USD et en % du solde de départ (fonds propres, flottant compris) ; positive si perte. */
export function perteJour(c: Compte, cot: Record<string, Cotation>): { montant: number; pct: number; depart: number } {
  const depart = soldeDebutJour(c);
  const montant = depart - etatCompte(c, cot).fondsPropres;
  return { montant, pct: depart > 0 ? (montant / depart) * 100 : 0, depart };
}

/** Raison de refuser l'opération qui fait passer `avant` à `apres`, ou null. */
export function refusRisque(avant: Compte, apres: Compte, r: ReglesRisque, cot: Record<string, Cotation>): string | null {
  const nouvelles = apres.positions.filter((p) => !avant.positions.some((x) => x.ticket === p.ticket));
  const nouveauxOrdres = apres.ordres.filter((o) => !avant.ordres.some((x) => x.ticket === o.ticket));
  if (!nouvelles.length && !nouveauxOrdres.length) return null;
  if (r.perteJourPct > 0) {
    const p = perteJour(avant, cot);
    if (p.pct >= r.perteJourPct) return `Limite de perte du jour atteinte (${p.pct.toFixed(2)} % ≥ ${r.perteJourPct} %) : nouveaux ordres bloqués jusqu'à demain`;
  }
  if (r.maxPositions > 0 && apres.positions.length + apres.ordres.length > r.maxPositions && apres.positions.length + apres.ordres.length > avant.positions.length + avant.ordres.length) {
    return `Limite de ${r.maxPositions} positions et ordres atteinte`;
  }
  if (r.maxVolume > 0 && [...nouvelles, ...nouveauxOrdres].some((x) => x.volume > r.maxVolume + 1e-9)) return `Volume limité à ${r.maxVolume.toFixed(2)} lot par position`;
  return null;
}

/** Ferme toutes les positions si la perte du jour dépasse la limite (option « fermer au seuil »). */
export function appliquerLimiteJour(c: Compte, r: ReglesRisque, cot: Record<string, Cotation>): { compte: Compte; message: string | null } {
  if (!r.fermerAuSeuil || r.perteJourPct <= 0 || !c.positions.length) return { compte: c, message: null };
  if (!c.positions.every((p) => cot[p.symbole])) return { compte: c, message: null };
  const p = perteJour(c, cot);
  if (p.pct < r.perteJourPct) return { compte: c, message: null };
  let suite = c;
  for (const x of c.positions) suite = fermerPosition(suite, x.ticket, cot, undefined, 'limite du jour').compte;
  const message = `${c.login} : limite de perte du jour atteinte (${p.pct.toFixed(2)} %), ${c.positions.length} position${c.positions.length > 1 ? 's' : ''} fermée${c.positions.length > 1 ? 's' : ''}`;
  return { compte: journaliser(suite, 'Trades', message), message };
}
