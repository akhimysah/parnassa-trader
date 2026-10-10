/**
 * Serveur Parnassa-Trader : ce que fait le serveur d'un courtier MT5 quand le terminal est fermé.
 *
 * Chaque minute, il relit les comptes en ligne (base de la néobanque, lecture des comptes « terminal » seulement)
 * qui ont des positions ou des ordres, rejoue les dernières bougies 1 minute dans le moteur du terminal et
 * enregistre le compte si un stop-loss, un take-profit, un ordre en attente, une expiration, un swap ou un
 * stop-out s'est produit. L'écriture est conditionnée à la date de l'état lu : si un terminal a enregistré
 * entre-temps, rien n'est écrasé. Les appareils abonnés reçoivent une notification push, ainsi que pour les
 * alertes de prix Bid/Ask choisies dans le terminal.
 */
import { journaliser, type Compte, type Evenement } from '../src/compte/moteur';
import { executerHorsLigne, symbolesCompte, cotationServeur, type Barre, type PrixServeur } from '../src/compte/serveur';
import { SYMBOLES_CONVERSION, symbole, formaterPrix, type TypeCompte } from '../src/marche/symboles';
import { copierSignal, statistiquesSignal, type Abonnement, type StatistiquesSignal } from '../src/compte/signaux';
import type { Cotation } from '../src/marche/cotations';
import { DurableObject } from 'cloudflare:workers';
import { envoyerPush, type AbonnementPush } from './push';

interface Env {
  DB: D1Database;
  TRADER: KVNamespace;
  HORLOGE: DurableObjectNamespace;
  VAPID_PUBLIQUE: string;
  VAPID_PRIVEE: string;
}

const URL_APP = 'https://akhimysah.github.io/parnassa-trader/';
const DUREE_SESSION = 30 * 24 * 60 * 60_000;
const TAILLE_MAX_ETAT = 1_800_000;
const NAVIGATEUR = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
const SERVICES_PUSH = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)\//i;

// ---------- Prix ----------

async function jsonDe<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function swissquote(instrument: string): Promise<number | null> {
  const d = await jsonDe<{ topo?: { platform?: string }; spreadProfilePrices?: { spreadProfile: string; bid: number; ask: number }[] }[]>(
    `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${instrument}`,
    { headers: NAVIGATEUR },
  );
  const p = d?.find((x) => x.topo?.platform === 'SwissquoteLtd') ?? d?.[0];
  const profil = p?.spreadProfilePrices?.find((x) => x.spreadProfile === 'premium') ?? p?.spreadProfilePrices?.[0];
  return profil && profil.bid > 0 && profil.ask > 0 ? (profil.bid + profil.ask) / 2 : null;
}

async function scanner(tickers: string[]): Promise<Map<string, number>> {
  const sortie = new Map<string, number>();
  if (!tickers.length) return sortie;
  const d = await jsonDe<{ data?: { s: string; d: (number | null)[] }[] }>('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    body: JSON.stringify({ symbols: { tickers }, columns: ['close'] }),
  });
  for (const l of d?.data ?? []) if (typeof l.d[0] === 'number') sortie.set(l.s, l.d[0]);
  return sortie;
}

async function barresYahoo(ticker: string): Promise<Barre[]> {
  for (const hote of ['query1', 'query2']) {
    const d = await jsonDe<{ chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[] } }[] } }>(
      `https://${hote}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`,
      { headers: NAVIGATEUR },
    );
    const r = d?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) continue;
    const sortie: Barre[] = [];
    r.timestamp.forEach((t, k) => {
      const [o, h, l, c] = [q.open[k], q.high[k], q.low[k], q.close[k]];
      if (o != null && h != null && l != null && c != null) sortie.push({ t: t * 1000, o, h, l, c });
    });
    return sortie.slice(-8);
  }
  return [];
}

/** Prix milieu actuel et bougies 1 minute récentes de chaque symbole, depuis les mêmes sources que le terminal. */
async function chargerPrix(noms: string[]): Promise<Record<string, PrixServeur>> {
  const sortie: Record<string, PrixServeur> = {};
  const symboles = noms.map((n) => symbole(n)).filter((s): s is NonNullable<typeof s> => !!s);
  const tv = await scanner(symboles.filter((s) => !s.direct.binance && !s.direct.swissquote && s.direct.tradingview).map((s) => s.direct.tradingview!));
  await Promise.all(
    symboles.map(async (s) => {
      if (s.direct.binance) {
        const p = s.direct.binance;
        const [k, livre] = await Promise.all([
          jsonDe<string[][]>(`https://data-api.binance.vision/api/v3/klines?symbol=${p}&interval=1m&limit=8`),
          jsonDe<{ bidPrice: string; askPrice: string }>(`https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=${p}`),
        ]);
        const bid = Number(livre?.bidPrice);
        const ask = Number(livre?.askPrice);
        if (!(bid > 0 && ask > 0)) return;
        sortie[s.nom] = {
          milieu: (bid + ask) / 2,
          ecart: ask - bid,
          barres: (k ?? []).map((x) => ({ t: Number(x[0]), o: Number(x[1]), h: Number(x[2]), l: Number(x[3]), c: Number(x[4]) })),
        };
        return;
      }
      const [direct, barres] = await Promise.all([s.direct.swissquote ? swissquote(s.direct.swissquote) : Promise.resolve(null), s.histo.yahoo ? barresYahoo(s.histo.yahoo) : Promise.resolve([])]);
      const milieu = direct ?? (s.direct.tradingview ? tv.get(s.direct.tradingview) : undefined) ?? barres[barres.length - 1]?.c;
      if (!milieu) return;
      // Bougies récentes seulement (marché ouvert), recalées sur la cotation directe (or : contrat à terme → spot).
      const recentes = barres.filter((b) => Date.now() - b.t < 10 * 60000);
      const decalage = recentes.length ? milieu - recentes[recentes.length - 1].c : 0;
      sortie[s.nom] = { milieu, barres: recentes.map((b) => ({ t: b.t, o: b.o + decalage, h: b.h + decalage, l: b.l + decalage, c: b.c + decalage })) };
    }),
  );
  return sortie;
}

// ---------- Abonnements push ----------

interface AbonnementCompte {
  abonnement: AbonnementPush;
  langue: 'fr' | 'en';
}
interface AlerteServeur {
  id: string;
  symbole: string;
  condition: 'bid>' | 'bid<' | 'ask>' | 'ask<';
  valeur: number;
  commentaire?: string;
}
interface AlertesAppareil {
  abonnement: AbonnementPush;
  langue: 'fr' | 'en';
  type: TypeCompte;
  alertes: AlerteServeur[];
  envoyees: string[];
}

async function sha256Hex(texte: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(d)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

async function cleAppareil(endpoint: string): Promise<string> {
  return (await sha256Hex(endpoint)).slice(0, 24);
}

function vapid(env: Env) {
  return { publique: env.VAPID_PUBLIQUE, privee: JSON.parse(env.VAPID_PRIVEE) as JsonWebKey, contact: URL_APP };
}

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}

/** Le jeton est-il une session ouverte du compte (même vérification que l'API de la néobanque) ? */
async function sessionValide(env: Env, login: number, jeton: string, trading = false): Promise<boolean> {
  if (typeof jeton !== 'string' || jeton.length < 16 || jeton.length > 200) return false;
  const s = await env.DB.prepare('SELECT login, read_only, created_at FROM trading_account_sessions WHERE id_hash = ?').bind(await sha256Hex(jeton)).first<{ login: string; read_only: number; created_at: number }>();
  // `trading` : le mot de passe principal est exigé (pas l'investisseur, en lecture seule).
  return !!s && String(s.login) === String(login) && Date.now() - s.created_at < DUREE_SESSION && (!trading || s.read_only === 0);
}

function nettoyerAlertes(a: unknown): AlerteServeur[] {
  if (!Array.isArray(a)) return [];
  return a
    .filter((x): x is AlerteServeur => !!x && typeof x.id === 'string' && !!symbole(x.symbole) && ['bid>', 'bid<', 'ask>', 'ask<'].includes(x.condition) && Number.isFinite(x.valeur))
    .slice(0, 50)
    .map((x) => ({ id: x.id.slice(0, 40), symbole: x.symbole, condition: x.condition, valeur: Number(x.valeur), commentaire: typeof x.commentaire === 'string' ? x.commentaire.slice(0, 80) : undefined }));
}

async function routes(requete: Request, env: Env): Promise<Response> {
  const url = new URL(requete.url);
  if (requete.method === 'OPTIONS') return json(null, 204);
  if (url.pathname === '/' || url.pathname === '/sante') return json({ service: 'parnassa-trader-serveur', routes: ['/cle', '/abonnement', '/desabonnement', '/test', '/signaux', '/signaux/abonnement?login=…', '/signaux/publier', '/signaux/retirer', '/signaux/abonner', '/signaux/desabonner'] });
  if (url.pathname === '/cle') return json({ cle: env.VAPID_PUBLIQUE });
  if (url.pathname === '/signaux' || url.pathname.startsWith('/signaux/')) return routesSignaux(requete, url, env);
  if (requete.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405);
  let corps: { abonnement?: AbonnementPush; endpoint?: string; comptes?: { login: number; jeton: string }[]; alertes?: unknown; langue?: string; type?: string; logins?: number[] };
  try {
    corps = (await requete.json()) as typeof corps;
  } catch {
    return json({ erreur: 'Corps JSON invalide.' }, 400);
  }
  const endpoint = corps.abonnement?.endpoint ?? corps.endpoint ?? '';
  if (!SERVICES_PUSH.test(endpoint)) return json({ erreur: 'Service de push non reconnu.' }, 400);
  const appareil = await cleAppareil(endpoint);

  if (url.pathname === '/abonnement') {
    const a = corps.abonnement;
    if (!a?.keys?.p256dh || !a.keys.auth) return json({ erreur: 'Abonnement incomplet.' }, 400);
    const abonnement: AbonnementPush = { endpoint: a.endpoint, keys: { p256dh: a.keys.p256dh, auth: a.keys.auth } };
    const langue = corps.langue === 'en' ? 'en' : 'fr';
    const verifies: number[] = [];
    for (const c of (corps.comptes ?? []).slice(0, 20)) {
      const login = Number(c?.login);
      if (!Number.isInteger(login) || !(await sessionValide(env, login, c.jeton))) continue;
      verifies.push(login);
      const cle = `login:${login}`;
      const liste = ((await env.TRADER.get(cle, 'json')) as AbonnementCompte[] | null) ?? [];
      const autres = liste.filter((x) => x.abonnement.endpoint !== endpoint);
      const nouvelle = [...autres, { abonnement, langue }].slice(-10);
      if (JSON.stringify(nouvelle) !== JSON.stringify(liste)) await env.TRADER.put(cle, JSON.stringify(nouvelle), { expirationTtl: 60 * 86400 });
    }
    // Alertes de prix : un seul enregistrement partagé, lu une fois par minute.
    const alertes = nettoyerAlertes(corps.alertes);
    const toutes = ((await env.TRADER.get('alertes', 'json')) as Record<string, AlertesAppareil> | null) ?? {};
    const avant = JSON.stringify(toutes[appareil] ?? null);
    if (alertes.length) toutes[appareil] = { abonnement, langue, type: corps.type === 'raw' ? 'raw' : 'standard', alertes, envoyees: (toutes[appareil]?.envoyees ?? []).filter((id) => alertes.some((x) => x.id === id)) };
    else delete toutes[appareil];
    if (JSON.stringify(toutes[appareil] ?? null) !== avant) await env.TRADER.put('alertes', JSON.stringify(toutes));
    return json({ ok: true, comptes: verifies, alertes: alertes.length });
  }
  if (url.pathname === '/desabonnement') {
    for (const login of (corps.logins ?? []).slice(0, 20)) {
      const cle = `login:${Number(login)}`;
      const liste = ((await env.TRADER.get(cle, 'json')) as AbonnementCompte[] | null) ?? [];
      const reste = liste.filter((x) => x.abonnement.endpoint !== endpoint);
      if (reste.length !== liste.length) await (reste.length ? env.TRADER.put(cle, JSON.stringify(reste), { expirationTtl: 60 * 86400 }) : env.TRADER.delete(cle));
    }
    const toutes = ((await env.TRADER.get('alertes', 'json')) as Record<string, AlertesAppareil> | null) ?? {};
    if (toutes[appareil]) {
      delete toutes[appareil];
      await env.TRADER.put('alertes', JSON.stringify(toutes));
    }
    return json({ ok: true });
  }
  if (url.pathname === '/test') {
    const a = corps.abonnement;
    if (!a?.keys?.p256dh || !a.keys.auth) return json({ erreur: 'Abonnement incomplet.' }, 400);
    const en = corps.langue === 'en';
    const r = await envoyerPush(a, { titre: 'Parnassa Trader', corps: en ? 'Push notifications work, even with the terminal closed.' : 'Les notifications push fonctionnent, même terminal fermé.', url: URL_APP, tag: 'test' }, vapid(env));
    return json({ resultat: r });
  }
  return json({ erreur: 'Route inconnue.' }, 404);
}

// ---------- Signaux (copie de trades) ----------

interface Signal {
  login: number;
  nom: string;
  description: string;
  publieLe: number;
}

/** Comptes Parnassa Trader (type terminal, ouverts) par numéro. */
async function lignesComptes(env: Env, logins: string[]): Promise<LigneCompte[]> {
  const sortie: LigneCompte[] = [];
  for (let i = 0; i < logins.length; i += 50) {
    const lot = logins.slice(i, i + 50);
    if (!lot.length) break;
    const { results } = await env.DB.prepare(
      `SELECT login, state, state_updated_at FROM trading_accounts WHERE kind = 'terminal' AND closed_at IS NULL AND state IS NOT NULL AND login IN (${lot.map(() => '?').join(',')})`,
    )
      .bind(...lot)
      .all<LigneCompte>();
    sortie.push(...(results ?? []));
  }
  return sortie;
}

function compteDe(ligne: LigneCompte): Compte | null {
  try {
    const c = (JSON.parse(ligne.state) as { compte?: Compte }).compte;
    return c && Array.isArray(c.positions) ? c : null;
  } catch {
    return null;
  }
}

async function routesSignaux(requete: Request, url: URL, env: Env): Promise<Response> {
  const signaux = ((await env.TRADER.get('signaux', 'json')) as Record<string, Signal> | null) ?? {};
  const abonnements = ((await env.TRADER.get('abonnements-signaux', 'json')) as Record<string, Abonnement> | null) ?? {};
  if (requete.method === 'GET' && url.pathname === '/signaux') {
    const lignes = await lignesComptes(env, Object.keys(signaux));
    const liste: (Signal & { abonnes: number; stats: StatistiquesSignal })[] = [];
    for (const l of lignes) {
      const c = compteDe(l);
      const sig = signaux[l.login];
      if (!c || !sig) continue;
      liste.push({ ...sig, abonnes: Object.values(abonnements).filter((a) => String(a.fournisseur) === l.login).length, stats: statistiquesSignal(c) });
    }
    liste.sort((a, b) => b.stats.croissancePct - a.stats.croissancePct);
    return json({ signaux: liste });
  }
  if (requete.method === 'GET' && url.pathname === '/signaux/abonnement') {
    return json({ abonnement: abonnements[url.searchParams.get('login') ?? ''] ?? null });
  }
  if (requete.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405);
  let corps: { login?: number; jeton?: string; nom?: string; description?: string; fournisseur?: number; ratio?: number };
  try {
    corps = (await requete.json()) as typeof corps;
  } catch {
    return json({ erreur: 'Corps JSON invalide.' }, 400);
  }
  const login = Number(corps.login);
  if (!Number.isInteger(login) || !(await sessionValide(env, login, corps.jeton ?? '', true))) return json({ erreur: 'Connectez ce compte avec son mot de passe principal.' }, 401);
  if (!(await lignesComptes(env, [String(login)])).length) return json({ erreur: 'Seuls les comptes en ligne Parnassa Trader peuvent utiliser les signaux.' }, 400);
  const cle = String(login);

  if (url.pathname === '/signaux/publier') {
    const nom = String(corps.nom ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (nom.length < 3) return json({ erreur: 'Nom du signal : 3 caractères au moins.' }, 400);
    if (abonnements[cle]) return json({ erreur: "Un compte abonné à un signal ne peut pas publier le sien : désabonnez-le d'abord." }, 400);
    signaux[cle] = { login, nom, description: String(corps.description ?? '').trim().slice(0, 300), publieLe: signaux[cle]?.publieLe ?? Date.now() };
    await env.TRADER.put('signaux', JSON.stringify(signaux));
    return json({ ok: true, signal: signaux[cle] });
  }
  if (url.pathname === '/signaux/retirer') {
    if (signaux[cle]) {
      delete signaux[cle];
      await env.TRADER.put('signaux', JSON.stringify(signaux));
      // Les abonnés ne copient plus rien : leurs abonnements sont retirés.
      let change = false;
      for (const [k, a] of Object.entries(abonnements))
        if (String(a.fournisseur) === cle) {
          delete abonnements[k];
          change = true;
        }
      if (change) await env.TRADER.put('abonnements-signaux', JSON.stringify(abonnements));
    }
    return json({ ok: true });
  }
  if (url.pathname === '/signaux/abonner') {
    const fournisseur = Number(corps.fournisseur);
    const ratio = Math.round(Number(corps.ratio) * 100) / 100;
    if (!signaux[String(fournisseur)]) return json({ erreur: 'Signal introuvable.' }, 404);
    if (fournisseur === login) return json({ erreur: 'Un compte ne peut pas copier son propre signal.' }, 400);
    if (signaux[cle]) return json({ erreur: 'Ce compte publie un signal : il ne peut pas en copier un autre.' }, 400);
    if (!(ratio >= 0.1 && ratio <= 10)) return json({ erreur: 'Coefficient de volume : de 0,1 à 10.' }, 400);
    abonnements[cle] = { fournisseur, ratio, depuis: Date.now() };
    await env.TRADER.put('abonnements-signaux', JSON.stringify(abonnements));
    return json({ ok: true, abonnement: abonnements[cle] });
  }
  if (url.pathname === '/signaux/desabonner') {
    if (abonnements[cle]) {
      delete abonnements[cle];
      await env.TRADER.put('abonnements-signaux', JSON.stringify(abonnements));
    }
    return json({ ok: true });
  }
  return json({ erreur: 'Route inconnue.' }, 404);
}

/** Bid/Ask actuels d'un compte (spreads de son type) pour les symboles cotés. */
function cotationsCompte(c: Compte, prix: Record<string, PrixServeur>, maintenant: number): Record<string, Cotation> {
  const sortie: Record<string, Cotation> = {};
  for (const [n, p] of Object.entries(prix)) {
    const q = cotationServeur(n, p.milieu, c.type ?? 'standard', p.ecart, maintenant);
    if (q) sortie[n] = q;
  }
  return sortie;
}

/** Copie de chaque fournisseur sur ses abonnés ; renvoie le nombre de comptes enregistrés. */
async function tourneeSignaux(
  env: Env,
  signaux: Record<string, Signal>,
  abonnements: Record<string, Abonnement>,
  comptes: { ligne: LigneCompte; etat: { compte: Compte } & Record<string, unknown> }[],
  prix: Record<string, PrixServeur>,
  maintenant: number,
  compterEnvois: (n: number) => void,
): Promise<number> {
  let ecrits = 0;
  for (const [abonne, a] of Object.entries(abonnements)) {
    if (!signaux[String(a.fournisseur)]) continue;
    const f = comptes.find((x) => x.ligne.login === String(a.fournisseur));
    const ab = comptes.find((x) => x.ligne.login === abonne);
    if (!f || !ab) continue;
    const r = copierSignal(ab.etat.compte, f.etat.compte, a, cotationsCompte(ab.etat.compte, prix, maintenant), maintenant);
    if (!r.modifie) continue;
    const compte = journaliser(r.compte, 'Réseau', `signal ${a.fournisseur} copié par le serveur Parnassa-Trader`);
    if ((await ecrireEtat(env, ab.ligne, ab.etat, compte)) === null) continue;
    ab.etat = { ...ab.etat, compte };
    ecrits += 1;
    compterEnvois(await prevenir(env, abonne, r.messages.map((corps) => ({ type: 'signal' as const, corps }))));
  }
  return ecrits;
}

// ---------- Tournée planifiée ----------

const TITRES: Record<Evenement['type'], [string, string]> = {
  execution: ['Ordre exécuté', 'Order filled'],
  sl: ['Stop Loss', 'Stop Loss'],
  tp: ['Take Profit', 'Take Profit'],
  'stop-out': ['Stop-out', 'Stop-out'],
  'appel-marge': ['Appel de marge', 'Margin call'],
  expiration: ['Ordre expiré', 'Order expired'],
  rejet: ['Ordre rejeté', 'Order rejected'],
};

interface LigneCompte {
  login: string;
  state: string;
  state_updated_at: number | null;
}

/**
 * Enregistre l'état d'un compte si personne ne l'a modifié depuis sa lecture (sinon un terminal a la main).
 * Renvoie la nouvelle date de l'état, ou null si rien n'a été écrit. La ligne en mémoire est mise à jour.
 */
async function ecrireEtat(env: Env, ligne: LigneCompte, etat: Record<string, unknown>, compte: Compte): Promise<number | null> {
  const nouvel = { ...etat, compte: { ...compte, journal: compte.journal.slice(-300) } };
  const texte = JSON.stringify(nouvel);
  if (texte.length > TAILLE_MAX_ETAT) return null;
  const majLe = Math.max(Date.now(), (ligne.state_updated_at ?? 0) + 1);
  const ecriture = await env.DB.prepare(
    ligne.state_updated_at === null
      ? 'UPDATE trading_accounts SET state = ?, state_updated_at = ? WHERE login = ? AND closed_at IS NULL AND state_updated_at IS NULL'
      : 'UPDATE trading_accounts SET state = ?, state_updated_at = ? WHERE login = ? AND closed_at IS NULL AND state_updated_at = ?',
  )
    .bind(...(ligne.state_updated_at === null ? [texte, majLe, ligne.login] : [texte, majLe, ligne.login, ligne.state_updated_at]))
    .run();
  if (!ecriture.meta.changes) return null;
  ligne.state = texte;
  ligne.state_updated_at = majLe;
  return majLe;
}

/** Notifications push aux appareils abonnés au compte ; renvoie le nombre d'envois. */
async function prevenir(env: Env, login: string, messages: { type: Evenement['type'] | 'signal'; corps: string }[]): Promise<number> {
  if (!messages.length) return 0;
  const abonnes = ((await env.TRADER.get(`login:${login}`, 'json')) as AbonnementCompte[] | null) ?? [];
  const restants: AbonnementCompte[] = [];
  let envois = 0;
  for (const a of abonnes) {
    let expire = false;
    for (const e of messages.slice(0, 4)) {
      const titre = e.type === 'signal' ? 'Signal' : TITRES[e.type][a.langue === 'en' ? 1 : 0];
      envois += 1;
      if ((await envoyerPush(a.abonnement, { titre: `${titre} · ${login}`, corps: e.corps, url: URL_APP, tag: `${login}-${e.type}-${Date.now()}-${envois}` }, vapid(env))) === 'expire') {
        expire = true;
        break;
      }
    }
    if (!expire) restants.push(a);
  }
  if (restants.length !== abonnes.length) await env.TRADER.put(`login:${login}`, JSON.stringify(restants), { expirationTtl: 60 * 86400 });
  return envois;
}

async function tournee(env: Env, maintenant: number): Promise<string> {
  const { results } = await env.DB.prepare(
    `SELECT login, state, state_updated_at FROM trading_accounts
     WHERE kind = 'terminal' AND closed_at IS NULL AND state IS NOT NULL
       AND (state LIKE '%"positions":[{%' OR state LIKE '%"ordres":[{%')
     LIMIT 300`,
  ).all<LigneCompte>();
  const comptes: { ligne: LigneCompte; etat: { compte: Compte } & Record<string, unknown> }[] = [];
  for (const ligne of results ?? []) {
    try {
      const etat = JSON.parse(ligne.state) as { compte?: Compte } & Record<string, unknown>;
      if (etat.compte && Array.isArray(etat.compte.positions) && Array.isArray(etat.compte.ordres)) comptes.push({ ligne, etat: etat as { compte: Compte } });
    } catch {
      // état illisible : laissé tel quel
    }
  }
  // Signaux : fournisseurs et abonnés sont chargés même sans position (un abonné vide reçoit des copies).
  const signaux = ((await env.TRADER.get('signaux', 'json')) as Record<string, Signal> | null) ?? {};
  const abonnementsSignaux = ((await env.TRADER.get('abonnements-signaux', 'json')) as Record<string, Abonnement> | null) ?? {};
  const aCharger = [...new Set(Object.entries(abonnementsSignaux).flatMap(([abonne, a]) => [abonne, String(a.fournisseur)]))].filter((l) => !comptes.some((c) => c.ligne.login === l));
  for (const ligne of await lignesComptes(env, aCharger)) {
    try {
      const etat = JSON.parse(ligne.state) as { compte?: Compte } & Record<string, unknown>;
      if (etat.compte && Array.isArray(etat.compte.positions) && Array.isArray(etat.compte.ordres)) comptes.push({ ligne, etat: etat as { compte: Compte } });
    } catch {
      // état illisible
    }
  }
  const alertes = ((await env.TRADER.get('alertes', 'json')) as Record<string, AlertesAppareil> | null) ?? {};
  const noms = new Set<string>(SYMBOLES_CONVERSION);
  for (const { etat } of comptes) for (const n of symbolesCompte(etat.compte)) noms.add(n);
  for (const a of Object.values(alertes)) for (const x of a.alertes) if (!a.envoyees.includes(x.id)) noms.add(x.symbole);
  if (comptes.length === 0 && noms.size === SYMBOLES_CONVERSION.length) return 'rien à surveiller';
  const prix = await chargerPrix([...noms].slice(0, 40));
  const cles = vapid(env);
  let ecrits = 0;
  let envois = 0;

  // Signaux : copie des fournisseurs sur leurs abonnés, avant l'exécution des stops (les copies en profitent).
  ecrits += await tourneeSignaux(env, signaux, abonnementsSignaux, comptes, prix, maintenant, (n) => (envois += n));

  for (const { ligne, etat } of comptes) {
    const c = etat.compte;
    const utiles: Record<string, PrixServeur> = {};
    for (const n of [...symbolesCompte(c), ...SYMBOLES_CONVERSION]) if (prix[n]) utiles[n] = prix[n];
    const depuis = Math.max(ligne.state_updated_at ?? 0, maintenant - 4 * 60000);
    const r = executerHorsLigne(c, utiles, depuis, maintenant);
    if (!r.modifie) continue;
    const compte = journaliser(r.compte, 'Réseau', 'opérations exécutées par le serveur Parnassa-Trader (terminal fermé)');
    if ((await ecrireEtat(env, ligne, etat, compte)) === null) continue;
    ecrits += 1;
    envois += await prevenir(
      env,
      ligne.login,
      r.evenements.filter((x) => x.type !== 'appel-marge').map((e) => ({ type: e.type, corps: e.message })),
    );
  }

  // Alertes Bid/Ask : sur le chemin des bougies récentes et le prix actuel.
  let alertesModifiees = false;
  for (const [cle, a] of Object.entries(alertes)) {
    for (const x of a.alertes) {
      if (a.envoyees.includes(x.id)) continue;
      const p = prix[x.symbole];
      const s = symbole(x.symbole);
      if (!p || !s) continue;
      const milieux = [...p.barres.filter((b) => b.t >= maintenant - 2 * 60000).flatMap((b) => [b.h, b.l]), p.milieu];
      const vraie = milieux.some((m) => {
        const q = cotationServeur(x.symbole, m, a.type, p.ecart, maintenant);
        if (!q) return false;
        const v = x.condition.startsWith('bid') ? q.bid : q.ask;
        return x.condition.endsWith('>') ? v > x.valeur : v < x.valeur;
      });
      if (!vraie) continue;
      const en = a.langue === 'en';
      const libelle = `${x.condition.startsWith('bid') ? 'Bid' : 'Ask'} ${x.condition.endsWith('>') ? '>' : '<'} ${formaterPrix(s, x.valeur)}`;
      const r = await envoyerPush(a.abonnement, { titre: `🔔 ${en ? 'Alert' : 'Alerte'} ${x.symbole}`, corps: `${libelle}${x.commentaire ? ` — ${x.commentaire}` : ''}`, url: URL_APP, tag: `alerte-${x.id}` }, cles);
      envois += 1;
      alertesModifiees = true;
      if (r === 'expire') {
        delete alertes[cle];
        break;
      }
      a.envoyees = [...a.envoyees, x.id].slice(-100);
    }
  }
  if (alertesModifiees) await env.TRADER.put('alertes', JSON.stringify(alertes));
  return `${comptes.length} compte(s) surveillé(s), ${Object.keys(prix).length} symbole(s) cotés, ${ecrits} enregistré(s), ${envois} notification(s)`;
}

/**
 * Horloge du serveur : une alarme Durable Object réarmée chaque minute fait la tournée (le compte Cloudflare
 * gratuit n'a plus de déclencheur planifié disponible). Toute requête au serveur la relance si elle s'est arrêtée.
 */
export class Horloge extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
    return new Response('ok');
  }
  async alarm(): Promise<void> {
    try {
      console.log(await tournee(this.env, Date.now()));
    } catch (e) {
      console.log(`tournée en échec : ${e instanceof Error ? e.message : e}`);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
    }
  }
}

export default {
  async fetch(requete: Request, env: Env): Promise<Response> {
    const horloge = env.HORLOGE.get(env.HORLOGE.idFromName('serveur'));
    await horloge.fetch('https://horloge/').catch(() => undefined);
    return routes(requete, env);
  },
};
