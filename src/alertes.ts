import type { Alerte } from './etat';
import type { Cotation } from './marche/cotations';
import { formaterPrix, symbole } from './marche/symboles';
import { dateMT } from './composants/ui';

/**
 * Alertes comme dans MT5 : prix (Bid / Ask au-dessus ou en dessous) ou heure, avec un nombre de déclenchements, une
 * pause entre deux déclenchements et une expiration. Une alerte épuisée ou expirée se désactive.
 */
export const CONDITIONS: Record<Alerte['condition'], string> = { 'bid>': 'Bid >', 'bid<': 'Bid <', 'ask>': 'Ask >', 'ask<': 'Ask <', 'heure=': 'Heure =' };

export function libelleAlerte(a: Alerte): string {
  const s = symbole(a.symbole);
  const v = a.condition === 'heure=' ? dateMT(a.valeur).slice(0, 16) : s ? formaterPrix(s, a.valeur) : String(a.valeur);
  return `${CONDITIONS[a.condition]} ${v}`;
}

export interface Declenchement {
  alerte: Alerte;
  message: string;
}

export function evaluerAlertes(alertes: Alerte[], cotations: Record<string, Cotation>, maintenant: number): { alertes: Alerte[]; declenchees: Declenchement[] } {
  const declenchees: Declenchement[] = [];
  let change = false;
  const suivantes = alertes.map((a) => {
    if (!a.active) return a;
    if (a.expiration && maintenant >= a.expiration) {
      change = true;
      return { ...a, active: false };
    }
    let vraie: boolean;
    if (a.condition === 'heure=') vraie = maintenant >= a.valeur;
    else {
      const q = cotations[a.symbole];
      if (!q) return a;
      const v = a.condition.startsWith('bid') ? q.bid : q.ask;
      vraie = a.condition.endsWith('>') ? v > a.valeur : v < a.valeur;
    }
    if (!vraie) return a;
    // Pause entre deux déclenchements (10 s par défaut, comme MT5).
    if (a.declencheeLe && maintenant - a.declencheeLe < (a.pause ?? 10) * 1000) return a;
    const fois = (a.declenchements ?? 0) + 1;
    const max = a.condition === 'heure=' ? 1 : (a.max ?? 1);
    change = true;
    const nouvelle = { ...a, declencheeLe: maintenant, declenchements: fois, active: fois < max };
    declenchees.push({ alerte: nouvelle, message: `Alerte ${a.symbole} : ${libelleAlerte(a)}${a.commentaire ? ` — ${a.commentaire}` : ''}${max > 1 ? ` (${fois}/${max})` : ''}` });
    return nouvelle;
  });
  return { alertes: change ? suivantes : alertes, declenchees };
}

/** Valeur d'un champ date-heure local (« 2026-10-10T14:30 ») depuis un horodatage, et inversement. */
export function versChampDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function depuisChampDate(v: string): number {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : Date.now();
}
