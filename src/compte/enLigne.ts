import { useCallback, useEffect, useRef, useState } from 'react';
import type { EtatTerminal } from '../etat';
import { URL_NEOBANQUE, jetonLiaison } from '../synchro';
import { nouveauCompte, journaliser, type Compte } from './moteur';
import type { TypeCompte } from '../marche/symboles';

/**
 * Comptes en ligne, comme chez un courtier MT5 : le compte vit sur le serveur Parnassa-Trader avec un numéro,
 * un mot de passe principal (trading) et un mot de passe investisseur (lecture seule). On s'y connecte depuis
 * n'importe quel appareil avec ces accès ; l'état du compte (positions, ordres, historique) suit la connexion.
 */
export const SERVEUR_EN_LIGNE = 'Parnassa-Trader';
const API = `${URL_NEOBANQUE}/api/parnassa/trading`;
const CLE_SESSIONS = 'parnassa-trader:sessions-comptes:v1';
const INTERVALLE_LECTURE = 15000;
const DELAI_ENVOI = 1500;

interface Session {
  jeton: string;
  lecture: boolean;
  /** Version du compte sur le serveur que cet appareil a vue en dernier. */
  base: number | null;
}

function lireSessions(): Record<string, Session> {
  try {
    return JSON.parse(localStorage.getItem(CLE_SESSIONS) ?? '{}') as Record<string, Session>;
  } catch {
    return {};
  }
}
function ecrireSessions(s: Record<string, Session>) {
  try {
    localStorage.setItem(CLE_SESSIONS, JSON.stringify(s));
  } catch {
    // stockage indisponible : la session tient jusqu'à la fermeture de la page
  }
}

async function appel(chemin: string, init: { methode?: string; jeton?: string | null; corps?: unknown } = {}) {
  const r = await fetch(`${API}/${chemin}`, {
    method: init.methode ?? 'GET',
    headers: { ...(init.jeton ? { Authorization: `Bearer ${init.jeton}` } : {}), ...(init.corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.corps !== undefined ? JSON.stringify(init.corps) : undefined,
  });
  let donnees: Record<string, unknown> = {};
  try {
    donnees = (await r.json()) as Record<string, unknown>;
  } catch {
    donnees = {};
  }
  return { statut: r.status, donnees };
}
const messageErreur = (d: Record<string, unknown>, defaut: string) => String((d.error as { message?: string } | undefined)?.message ?? defaut);

export interface Acces {
  login: number;
  serveur: string;
  motDePasse: string;
  motDePasseInvestisseur: string;
}

/** Ce qui part sur le serveur : le compte, journal raccourci. */
function etatDistant(c: Compte) {
  return { plateforme: 'parnassa-trader', version: 1, compte: { ...c, journal: c.journal.slice(-300), lecture: undefined, enLigne: undefined } };
}

/** Empreinte des changements utiles d'un compte (le journal seul ne déclenche pas d'envoi). */
function empreinte(c: Compte): string {
  const texte = JSON.stringify({ ...c, journal: c.journal.length, lecture: undefined });
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${texte.length}:${h >>> 0}`;
}

function depuisDistant(distant: unknown, login: number, lecture: boolean): Compte | null {
  const c = (distant as { compte?: Compte } | null)?.compte;
  if (!c || typeof c.solde !== 'number' || !Array.isArray(c.positions)) return null;
  return { ...c, login, serveur: SERVEUR_EN_LIGNE, enLigne: true, lecture: lecture || undefined };
}

export interface CompteServeur {
  login: number;
  nom: string;
  capital: number;
  creeLe: number;
  derniereConnexion: number | null;
  resume?: { balance: number | null; positions: number };
}

export type StatutCompte = 'connecte' | 'connexion' | 'deconnecte' | 'erreur';

export interface ComptesEnLigne {
  /** État de la connexion de chaque compte en ligne (par numéro). */
  statut: (login: number) => StatutCompte;
  erreur: (login: number) => string | null;
  ouvrir: (o: { nom: string; depot: number; levier: number; type: TypeCompte; sansSwap: boolean }) => Promise<Acces>;
  connecter: (login: number, motDePasse: string, serveur: string) => Promise<Compte>;
  /** Comptes en ligne rattachés au compte Parnassa relié (null sans liaison). */
  mesComptes: () => Promise<CompteServeur[] | null>;
  /** Connexion sans mot de passe pour le propriétaire, par la liaison au compte Parnassa. */
  connecterProprietaire: (login: number) => Promise<Compte>;
  /** Propriétaire (compte Parnassa relié) : nouveaux mots de passe, les anciens et toutes les sessions tombent. */
  nouveauxMotsDePasse: (login: number) => Promise<Acces>;
  /** Propriétaire : fermeture définitive du compte sur le serveur. */
  fermerCompte: (login: number) => Promise<void>;
  renommer: (login: number, nom: string) => Promise<void>;
  deconnecter: (login: number) => Promise<void>;
}

/**
 * Connexion des comptes en ligne : lecture au branchement, envoi des changements, reprise de ceux faits sur
 * un autre appareil (au retour sur l'application et toutes les 15 s). Une version plus récente sur le serveur
 * l'emporte, comme chez un courtier où le serveur fait foi.
 */
export function useComptesEnLigne(etat: EtatTerminal, maj: (f: (e: EtatTerminal) => EtatTerminal) => void, signaler: (m: string) => void): ComptesEnLigne {
  const sessions = useRef<Record<string, Session>>(lireSessions());
  const [statuts, setStatuts] = useState<Record<number, StatutCompte>>(() =>
    Object.fromEntries(etat.comptes.filter((c) => c.enLigne).map((c) => [c.login, sessions.current[c.login] ? 'connexion' : 'deconnecte'])),
  );
  const [erreurs, setErreurs] = useState<Record<number, string | null>>({});
  const envoyees = useRef<Record<number, string>>({});
  const prets = useRef<Set<number>>(new Set());
  const refEtat = useRef(etat);
  refEtat.current = etat;

  const fixer = (login: number, statut: StatutCompte, erreur: string | null = null) => {
    setStatuts((s) => (s[login] === statut ? s : { ...s, [login]: statut }));
    setErreurs((e) => (e[login] === erreur ? e : { ...e, [login]: erreur }));
  };
  const garderSession = (login: number, s: Session | null) => {
    if (s) sessions.current = { ...sessions.current, [login]: s };
    else {
      const { [login]: _, ...reste } = sessions.current;
      sessions.current = reste;
    }
    ecrireSessions(sessions.current);
  };
  const remplacerCompte = useCallback(
    (c: Compte) => {
      envoyees.current[c.login] = empreinte(c);
      maj((e) => ({ ...e, comptes: e.comptes.some((k) => k.login === c.login) ? e.comptes.map((k) => (k.login === c.login ? c : k)) : [...e.comptes, c] }));
    },
    [maj],
  );
  const perdre = useCallback(
    (login: number, message: string) => {
      garderSession(login, null);
      prets.current.delete(login);
      fixer(login, 'deconnecte', message);
      signaler(`${login} : ${message}`);
    },
    [signaler],
  );

  const envoyer = useCallback(
    async (login: number, forcer = false) => {
      const s = sessions.current[login];
      const c = refEtat.current.comptes.find((k) => k.login === login);
      if (!s || !c || s.lecture) return;
      const cle = empreinte(c);
      try {
        const r = await appel('compte', { methode: 'PUT', jeton: s.jeton, corps: { etat: etatDistant(c), base: s.base, forcer } });
        if (r.statut === 401) return perdre(login, 'session expirée, reconnectez-vous avec le mot de passe du compte.');
        if (r.statut === 409) {
          const distant = depuisDistant(r.donnees.etat, login, false);
          garderSession(login, { ...s, base: Number(r.donnees.majLe) || null });
          if (distant) {
            remplacerCompte(journaliser(distant, 'Réseau', 'compte mis à jour depuis un autre appareil'));
            signaler(`${login} : compte mis à jour depuis un autre appareil`);
          }
          fixer(login, 'connecte');
          return;
        }
        if (r.statut !== 200) throw new Error(messageErreur(r.donnees, `Erreur ${r.statut}`));
        envoyees.current[login] = cle;
        garderSession(login, { ...s, base: Number(r.donnees.majLe) });
        fixer(login, 'connecte');
      } catch (err) {
        fixer(login, 'erreur', err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'serveur injoignable');
      }
    },
    [perdre, remplacerCompte, signaler],
  );

  const lire = useCallback(
    async (login: number) => {
      const s = sessions.current[login];
      if (!s) return;
      try {
        const r = await appel('compte', { jeton: s.jeton });
        if (r.statut === 401) return perdre(login, 'session expirée, reconnectez-vous avec le mot de passe du compte.');
        if (r.statut !== 200) throw new Error(messageErreur(r.donnees, `Erreur ${r.statut}`));
        const majLe = typeof r.donnees.majLe === 'number' ? r.donnees.majLe : null;
        const lecture = r.donnees.lecture === true;
        const distant = depuisDistant(r.donnees.etat, login, lecture);
        const local = refEtat.current.comptes.find((k) => k.login === login);
        if (!distant || majLe === null) {
          // Compte encore vide sur le serveur : il reçoit celui de cet appareil.
          prets.current.add(login);
          if (local && !lecture) await envoyer(login, true);
          else fixer(login, 'connecte');
          return;
        }
        if (s.base === null || majLe > s.base || !local) {
          garderSession(login, { ...s, base: majLe, lecture });
          remplacerCompte(local ? { ...distant, journal: local.journal } : distant);
        }
        prets.current.add(login);
        fixer(login, 'connecte');
      } catch (err) {
        fixer(login, 'erreur', err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'serveur injoignable');
      }
    },
    [envoyer, perdre, remplacerCompte],
  );

  // Branchement de chaque compte qui a une session, puis lecture régulière et au retour sur l'application.
  const enLigne = etat.comptes.filter((c) => c.enLigne).map((c) => c.login);
  const cleEnLigne = enLigne.join(',');
  useEffect(() => {
    const logins = cleEnLigne ? cleEnLigne.split(',').map(Number) : [];
    for (const l of logins) if (!prets.current.has(l) && sessions.current[l]) void lire(l);
    setStatuts((s) => {
      let change = false;
      const n = { ...s };
      for (const l of logins) {
        if (!sessions.current[l] && n[l] !== 'deconnecte') {
          n[l] = 'deconnecte';
          change = true;
        }
      }
      return change ? n : s;
    });
    const tout = () => {
      for (const l of logins) if (sessions.current[l]) void lire(l);
    };
    const t = window.setInterval(tout, INTERVALLE_LECTURE);
    const visible = () => {
      if (document.visibilityState === 'visible') tout();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [cleEnLigne, lire]);

  // Envoi des changements des comptes connectés.
  const cles = etat.comptes
    .filter((c) => c.enLigne && !c.lecture && prets.current.has(c.login) && sessions.current[c.login])
    .map((c) => `${c.login}=${empreinte(c)}`)
    .join('|');
  useEffect(() => {
    if (!cles) return;
    const aEnvoyer = cles
      .split('|')
      .map((x) => x.split('='))
      .filter(([l, e]) => envoyees.current[Number(l)] !== e)
      .map(([l]) => Number(l));
    if (!aEnvoyer.length) return;
    const t = window.setTimeout(() => {
      for (const l of aEnvoyer) void envoyer(l);
    }, DELAI_ENVOI);
    return () => window.clearTimeout(t);
  }, [cles, envoyer]);

  /** Après une connexion acceptée : lecture du compte sur le serveur et mise en place sur cet appareil. */
  const brancher = useCallback(
    async (login: number, jeton: string, lecture: boolean, infos: { nom?: string; capital?: number }): Promise<Compte> => {
      garderSession(login, { jeton, lecture, base: null });
      const lu = await appel('compte', { jeton });
      const majLe = typeof lu.donnees.majLe === 'number' ? lu.donnees.majLe : null;
      let compte = depuisDistant(lu.donnees.etat, login, lecture);
      const local = refEtat.current.comptes.find((k) => k.login === login);
      if (!compte) {
        // Premier branchement d'un compte ouvert ailleurs sans état : compte neuf au capital du serveur.
        const neuf = local ?? nouveauCompte(infos.nom ?? `Compte ${login}`, infos.capital ?? 10000, 100);
        compte = { ...neuf, login, serveur: SERVEUR_EN_LIGNE, enLigne: true, lecture: lecture || undefined };
      } else if (local) compte = { ...compte, journal: local.journal };
      compte = journaliser(compte, 'Réseau', `'${login}' : connecté à ${SERVEUR_EN_LIGNE}${lecture ? ' (mot de passe investisseur, lecture seule)' : ''}`);
      garderSession(login, { jeton, lecture, base: majLe });
      remplacerCompte(compte);
      prets.current.add(login);
      if (majLe === null && !lecture) await envoyer(login, true);
      fixer(login, 'connecte');
      return compte;
    },
    [envoyer, remplacerCompte],
  );

  const connexion = useCallback(
    async (login: number, corps: Record<string, unknown>, jeton: string | null): Promise<Compte> => {
      fixer(login, 'connexion');
      let r: Awaited<ReturnType<typeof appel>>;
      try {
        r = await appel('connexion', { methode: 'POST', jeton, corps: { login: String(login), plateforme: 'trader', ...corps } });
      } catch {
        fixer(login, sessions.current[login] ? 'erreur' : 'deconnecte', 'serveur injoignable');
        throw new Error('Serveur injoignable : vérifiez votre connexion Internet.');
      }
      if (r.statut !== 200) {
        fixer(login, sessions.current[login] ? 'erreur' : 'deconnecte');
        throw new Error(messageErreur(r.donnees, 'Connexion impossible.'));
      }
      return brancher(login, String(r.donnees.jeton), r.donnees.lecture === true, r.donnees.compte as { nom?: string; capital?: number });
    },
    [brancher],
  );
  const connecter = useCallback((login: number, motDePasse: string, serveur: string) => connexion(login, { motDePasse, serveur }, null), [connexion]);
  const connecterProprietaire = useCallback((login: number) => connexion(login, { proprietaire: true }, jetonLiaison()), [connexion]);
  const mesComptes = useCallback(async (): Promise<CompteServeur[] | null> => {
    const liaison = jetonLiaison();
    if (!liaison) return null;
    const r = await appel('comptes?plateforme=trader', { jeton: liaison });
    if (r.statut !== 200) throw new Error(messageErreur(r.donnees, 'Liste des comptes indisponible.'));
    return ((r.donnees.comptes as (Omit<CompteServeur, 'login'> & { login: string })[]) ?? []).map((c) => ({ ...c, login: Number(c.login) }));
  }, []);

  const ouvrir = useCallback(
    async (o: { nom: string; depot: number; levier: number; type: TypeCompte; sansSwap: boolean }): Promise<Acces> => {
      const liaison = jetonLiaison();
      let r: Awaited<ReturnType<typeof appel>>;
      try {
        r = await appel('comptes?plateforme=trader', { methode: 'POST', jeton: liaison, corps: { type: 'terminal', capital: Math.round(o.depot), nom: o.nom } });
      } catch {
        throw new Error('Serveur injoignable : vérifiez votre connexion Internet.');
      }
      if (r.statut !== 201) throw new Error(messageErreur(r.donnees, 'Ouverture du compte impossible.'));
      const a = r.donnees.acces as { login: string; serveur: string; motDePasse: string; motDePasseInvestisseur: string };
      const login = Number(a.login);
      const base = nouveauCompte(o.nom, Math.round(o.depot), o.levier, o.type, o.sansSwap);
      const neuf: Compte = {
        ...base,
        login,
        serveur: SERVEUR_EN_LIGNE,
        enLigne: true,
        journal: [{ heure: Date.now(), source: 'Réseau', message: `'${login}' : compte de démonstration ouvert sur ${SERVEUR_EN_LIGNE}, dépôt ${o.depot.toFixed(2)} USD, levier 1:${o.levier}` }],
      };
      remplacerCompte(neuf);
      envoyees.current[login] = '';
      await connecter(login, a.motDePasse, a.serveur);
      return { login, serveur: a.serveur, motDePasse: a.motDePasse, motDePasseInvestisseur: a.motDePasseInvestisseur };
    },
    [connecter, remplacerCompte],
  );

  const gerer = useCallback(async (methode: 'PATCH' | 'DELETE', corps: Record<string, unknown>) => {
    const liaison = jetonLiaison();
    if (!liaison) throw new Error('Reliez d’abord Parnassa Trader à votre compte Parnassa (Paramètres → Compte Parnassa).');
    let r: Awaited<ReturnType<typeof appel>>;
    try {
      r = await appel('comptes?plateforme=trader', { methode, jeton: liaison, corps });
    } catch {
      throw new Error('Serveur injoignable : vérifiez votre connexion Internet.');
    }
    if (r.statut === 404) throw new Error('Ce compte n’est pas rattaché à votre compte Parnassa : seul son propriétaire peut le gérer.');
    if (r.statut !== 200) throw new Error(messageErreur(r.donnees, 'Opération impossible.'));
    return r.donnees;
  }, []);
  const nouveauxMotsDePasse = useCallback(
    async (login: number): Promise<Acces> => {
      const d = await gerer('PATCH', { action: 'mots-de-passe', login: String(login) });
      const a = d.acces as { motDePasse: string; motDePasseInvestisseur: string };
      // Toutes les sessions du compte sont fermées, celle-ci comprise : on la rouvre en propriétaire.
      garderSession(login, null);
      prets.current.delete(login);
      await connexion(login, { proprietaire: true }, jetonLiaison()).catch(() => fixer(login, 'deconnecte'));
      return { login, serveur: SERVEUR_EN_LIGNE, motDePasse: a.motDePasse, motDePasseInvestisseur: a.motDePasseInvestisseur };
    },
    [gerer, connexion],
  );
  const fermerCompte = useCallback(
    async (login: number) => {
      await gerer('DELETE', { login: String(login) });
      garderSession(login, null);
      prets.current.delete(login);
      fixer(login, 'deconnecte');
    },
    [gerer],
  );
  const renommer = useCallback(
    async (login: number, nom: string) => {
      await gerer('PATCH', { action: 'renommer', login: String(login), nom });
    },
    [gerer],
  );

  const deconnecter = useCallback(async (login: number) => {
    const s = sessions.current[login];
    garderSession(login, null);
    prets.current.delete(login);
    fixer(login, 'deconnecte');
    if (s) await appel('connexion', { methode: 'DELETE', jeton: s.jeton }).catch(() => undefined);
  }, []);

  return {
    statut: (login) => statuts[login] ?? (sessions.current[login] ? 'connexion' : 'deconnecte'),
    erreur: (login) => erreurs[login] ?? null,
    ouvrir,
    connecter,
    mesComptes,
    connecterProprietaire,
    nouveauxMotsDePasse,
    fermerCompte,
    renommer,
    deconnecter,
  };
}

/** Un compte en ligne sans session (ou en lecture seule) ne peut pas trader depuis cet appareil. */
export function refusTrading(c: Compte, statut: StatutCompte): string | null {
  if (!c.enLigne) return null;
  if (c.lecture) return 'Trading désactivé : connecté avec le mot de passe investisseur (lecture seule).';
  if (statut === 'deconnecte') return `Compte ${c.login} non connecté : connectez-vous avec son mot de passe (Fichier → Se connecter à un compte de trading).`;
  return null;
}
