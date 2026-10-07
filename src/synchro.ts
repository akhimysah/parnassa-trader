import { useCallback, useEffect, useRef, useState } from 'react';
import type { EtatTerminal } from './etat';
import { fusionnerEtat } from './etat';

/** Compte Parnassa (néobanque) : liaison par jeton propre à Parnassa Trader, puis synchronisation entre appareils. */
export const URL_NEOBANQUE = 'https://parnassa.neobank.workers.dev';
const API = `${URL_NEOBANQUE}/api/parnassa/trader/sync`;
const CLE_JETON = 'parnassa-trader:jeton-parnassa:v1';
const CLE_BASE = 'parnassa-trader:synchro-base:v1';
const INTERVALLE_ENVOI = 15000;
const INTERVALLE_LECTURE = 60000;

function lire(cle: string): string | null {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}
function ecrire(cle: string, valeur: string | null) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    // stockage indisponible
  }
}

/** Au retour de la page de consentement, le jeton arrive dans le fragment : on le garde et on l'efface de l'adresse. */
export function capturerJetonDepuisAdresse(): boolean {
  const m = window.location.hash.match(/^#parnassa-jeton=([A-Za-z0-9_-]{32,100})$/);
  if (!m) return false;
  ecrire(CLE_JETON, m[1]);
  ecrire(CLE_BASE, null);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
}

export function lienLiaison(): string {
  const retour = `${window.location.origin}${window.location.pathname}`;
  return `${URL_NEOBANQUE}/api/parnassa/trader/autoriser?retour=${encodeURIComponent(retour)}`;
}

/**
 * Champs propres à chaque appareil, jamais envoyés : disposition de l'écran, et surtout l'Algo Trading,
 * pour que deux appareils ne fassent pas trader les mêmes experts en double.
 */
const LOCAUX = ['panneaux', 'hauteurBoite', 'graphiqueActif', 'disposition', 'algo'] as const;
type Local = (typeof LOCAUX)[number];

/** Journal limité aux 300 dernières lignes par compte pour garder la copie en ligne légère. */
function aEnvoyer(etat: EtatTerminal): Omit<EtatTerminal, Local> {
  const copie: Record<string, unknown> = { ...etat };
  for (const k of LOCAUX) delete copie[k];
  copie.comptes = etat.comptes.map((c) => ({ ...c, journal: c.journal.slice(-300) }));
  return copie as Omit<EtatTerminal, Local>;
}

/** Empreinte des changements utiles (le journal seul ne déclenche pas d'envoi). */
function empreinte(etat: EtatTerminal): string {
  const e = aEnvoyer(etat);
  const texte = JSON.stringify({ ...e, comptes: e.comptes.map((c) => ({ ...c, journal: c.journal.length })) });
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${texte.length}:${h >>> 0}`;
}

export type StatutSynchro = 'deconnecte' | 'connexion' | 'a-jour' | 'envoi' | 'erreur';

export interface Synchro {
  statut: StatutSynchro;
  compte: { email: string; nom: string } | null;
  derniereSynchro: number | null;
  erreur: string | null;
  synchroniser: () => void;
  deconnecter: () => Promise<void>;
}

async function appel(methode: 'GET' | 'PUT' | 'DELETE', jeton: string, corps?: unknown): Promise<{ statut: number; donnees: Record<string, unknown> }> {
  const r = await fetch(API, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  let donnees: Record<string, unknown> = {};
  try {
    donnees = (await r.json()) as Record<string, unknown>;
  } catch {
    donnees = {};
  }
  return { statut: r.status, donnees };
}

/**
 * Synchronisation avec le compte Parnassa : au branchement, choix entre les données du compte et celles de
 * l'appareil ; ensuite envoi des changements (au plus toutes les 15 s) et reprise de ceux faits ailleurs.
 */
export function useSynchro(etat: EtatTerminal, remplacer: (e: EtatTerminal) => void, signaler: (m: string) => void): Synchro {
  const [jeton, setJeton] = useState<string | null>(() => lire(CLE_JETON));
  const [statut, setStatut] = useState<StatutSynchro>(jeton ? 'connexion' : 'deconnecte');
  const [compte, setCompte] = useState<Synchro['compte']>(null);
  const [derniereSynchro, setDerniereSynchro] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pret, setPret] = useState(false);
  const base = useRef<number | null>(Number(lire(CLE_BASE)) || null);
  const envoyee = useRef<string | null>(null);
  const dernierEnvoi = useRef(0);
  const refEtat = useRef(etat);
  refEtat.current = etat;

  const fixerBase = (majLe: number | null) => {
    base.current = majLe;
    ecrire(CLE_BASE, majLe === null ? null : String(majLe));
  };

  const adopter = useCallback(
    (distant: unknown, majLe: number, message?: string) => {
      const local = refEtat.current;
      const nouvel = fusionnerEtat({ ...(distant as Partial<EtatTerminal>), ...Object.fromEntries(LOCAUX.map((k) => [k, local[k]])) });
      envoyee.current = empreinte(nouvel);
      fixerBase(majLe);
      remplacer(nouvel);
      setDerniereSynchro(Date.now());
      if (message) signaler(message);
    },
    [remplacer, signaler],
  );

  const perdreJeton = useCallback(
    (message: string) => {
      ecrire(CLE_JETON, null);
      fixerBase(null);
      setJeton(null);
      setCompte(null);
      setStatut('deconnecte');
      setPret(false);
      signaler(message);
    },
    [signaler],
  );

  const envoyer = useCallback(
    async (forcer = false) => {
      if (!jeton) return;
      const e = refEtat.current;
      const cle = empreinte(e);
      setStatut('envoi');
      try {
        const r = await appel('PUT', jeton, { etat: aEnvoyer(e), base: base.current, forcer });
        if (r.statut === 401) return perdreJeton('Connexion Parnassa expirée : reliez à nouveau l’application dans les Paramètres.');
        if (r.statut === 409) {
          adopter(r.donnees.etat, Number(r.donnees.majLe), 'Données mises à jour depuis un autre appareil.');
          setStatut('a-jour');
          return;
        }
        if (r.statut !== 200) throw new Error(String((r.donnees.error as { message?: string })?.message ?? `Erreur ${r.statut}`));
        envoyee.current = cle;
        dernierEnvoi.current = Date.now();
        fixerBase(Number(r.donnees.majLe));
        setDerniereSynchro(Date.now());
        setErreur(null);
        setStatut('a-jour');
      } catch (err) {
        setErreur(err instanceof Error ? err.message : 'Synchronisation impossible.');
        setStatut('erreur');
      }
    },
    [jeton, adopter, perdreJeton],
  );

  const lireCompte = useCallback(
    async (premiere: boolean) => {
      if (!jeton) return;
      try {
        const r = await appel('GET', jeton);
        if (r.statut === 401) return perdreJeton('Connexion Parnassa expirée : reliez à nouveau l’application dans les Paramètres.');
        if (r.statut !== 200) throw new Error(String((r.donnees.error as { message?: string })?.message ?? `Erreur ${r.statut}`));
        setCompte(r.donnees.compte as Synchro['compte']);
        const majLe = typeof r.donnees.majLe === 'number' ? r.donnees.majLe : null;
        const distant = r.donnees.etat;
        if (premiere) {
          if (!distant || majLe === null) {
            // Compte vide : il reçoit les données de cet appareil.
            setPret(true);
            await envoyer(true);
            signaler('Compte Parnassa relié : vos données sont sauvegardées en ligne.');
            return;
          }
          if (base.current === null) {
            // Premier branchement de cet appareil alors que le compte a déjà des données : le client choisit.
            const date = new Date(majLe).toLocaleString('fr-FR');
            const garderCompte = window.confirm(
              `Votre compte Parnassa contient déjà des données Parnassa Trader (comptes de démonstration, graphiques, alertes) (mises à jour le ${date}).\n\nOK : les utiliser sur cet appareil.\nAnnuler : remplacer celles du compte par les données de cet appareil.`,
            );
            setPret(true);
            if (garderCompte) adopter(distant, majLe, 'Données du compte Parnassa chargées sur cet appareil.');
            else await envoyer(true);
            setStatut('a-jour');
            return;
          }
          setPret(true);
        }
        if (majLe !== null && base.current !== null && majLe > base.current) {
          adopter(distant, majLe, premiere ? undefined : 'Données mises à jour depuis un autre appareil.');
        }
        setDerniereSynchro(Date.now());
        setErreur(null);
        setStatut('a-jour');
      } catch (err) {
        setErreur(err instanceof Error ? err.message : 'Synchronisation impossible.');
        setStatut('erreur');
      }
    },
    [jeton, adopter, envoyer, perdreJeton, signaler],
  );

  // Branchement, puis lecture régulière et au retour sur l'onglet.
  useEffect(() => {
    if (!jeton) return;
    void lireCompte(true);
    const t = window.setInterval(() => void lireCompte(false), INTERVALLE_LECTURE);
    const visible = () => {
      if (document.visibilityState === 'visible') void lireCompte(false);
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [jeton, lireCompte]);

  // Envoi des changements, au plus toutes les 15 secondes.
  const cle = pret ? empreinte(etat) : null;
  useEffect(() => {
    if (!jeton || !pret || cle === null || cle === envoyee.current) return;
    const attente = Math.max(1500, dernierEnvoi.current + INTERVALLE_ENVOI - Date.now());
    const t = window.setTimeout(() => void envoyer(), attente);
    return () => window.clearTimeout(t);
  }, [jeton, pret, cle, envoyer]);

  const deconnecter = useCallback(async () => {
    if (jeton) await appel('DELETE', jeton).catch(() => undefined);
    perdreJeton('Compte Parnassa déconnecté de cet appareil (les données restent ici et sur le compte).');
  }, [jeton, perdreJeton]);

  return {
    statut,
    compte,
    derniereSynchro,
    erreur,
    synchroniser: () => {
      void (async () => {
        await envoyer();
        await lireCompte(false);
      })();
    },
    deconnecter,
  };
}
