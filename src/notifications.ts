/**
 * Notifications du téléphone (exécutions, stop-loss / take-profit, stop-out, alertes de prix).
 * Passées par le service worker quand il est actif : c'est la seule voie qui marche sur Android.
 */
export function notificationsDisponibles(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function demanderPermission(): Promise<boolean> {
  if (!notificationsDisponibles()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/** Affiche une notification si elle est autorisée ; `toujours` = même quand l'application est visible. */
export function notifier(titre: string, corps: string, toujours = false) {
  if (!notificationsDisponibles() || Notification.permission !== 'granted') return;
  if (!toujours && document.visibilityState === 'visible') return;
  const options: NotificationOptions = { body: corps, icon: `${import.meta.env.BASE_URL}icone-192.png`, badge: `${import.meta.env.BASE_URL}icone-192.png`, tag: `${titre}-${corps}`.slice(0, 64) };
  const repli = () => {
    try {
      new Notification(titre, options);
    } catch {
      // le navigateur exige le service worker (Android) : rien d'autre à faire
    }
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((r) => (r ? r.showNotification(titre, options) : repli()))
      .catch(repli);
  } else repli();
}

// ---------- Push du serveur Parnassa-Trader (terminal fermé) ----------

/** Serveur qui exécute SL/TP et ordres en attente des comptes en ligne et envoie les push, terminal fermé. */
export const SERVEUR_TRADER = 'https://parnassa-trader-serveur.neobank.workers.dev';
const CLE_SESSIONS = 'parnassa-trader:sessions-comptes:v1';

export interface AlertePush {
  id: string;
  symbole: string;
  condition: 'bid>' | 'bid<' | 'ask>' | 'ask<';
  valeur: number;
  commentaire?: string;
}

function depuisBase64Url(texte: string): Uint8Array<ArrayBuffer> {
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (texte.length % 4)) % 4);
  const binaire = atob(b64);
  const tab = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) tab[i] = binaire.charCodeAt(i);
  return tab;
}

function comptesConnectes(): { login: number; jeton: string }[] {
  try {
    const s = JSON.parse(localStorage.getItem(CLE_SESSIONS) ?? '{}') as Record<string, { jeton?: string }>;
    return Object.entries(s)
      .filter(([, v]) => typeof v?.jeton === 'string')
      .map(([login, v]) => ({ login: Number(login), jeton: v.jeton! }));
  } catch {
    return [];
  }
}

async function poster(chemin: string, corps: unknown) {
  const r = await fetch(`${SERVEUR_TRADER}${chemin}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; comptes?: number[]; erreur?: string; resultat?: string };
}

/**
 * Abonne cet appareil aux push du serveur (exécutions des comptes en ligne et alertes Bid/Ask), ou le désabonne.
 * Renvoie les comptes pour lesquels le serveur a reconnu la session.
 */
export async function synchroniserPush(actif: boolean, alertes: AlertePush[], type: 'standard' | 'raw'): Promise<number[] | null> {
  if (!notificationsDisponibles() || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const enregistrement = await navigator.serviceWorker.getRegistration();
  if (!enregistrement) return null;
  const existant = await enregistrement.pushManager.getSubscription();
  const comptes = comptesConnectes();
  if (!actif || Notification.permission !== 'granted') {
    if (existant) await poster('/desabonnement', { endpoint: existant.endpoint, logins: comptes.map((c) => c.login) }).catch(() => undefined);
    return null;
  }
  let abonnement = existant;
  if (!abonnement) {
    const { cle } = (await (await fetch(`${SERVEUR_TRADER}/cle`)).json()) as { cle: string };
    abonnement = await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: depuisBase64Url(cle) });
  }
  const r = await poster('/abonnement', { abonnement: abonnement.toJSON(), comptes, alertes, type, langue: 'fr' });
  return r.comptes ?? null;
}

/** Envoie une notification de test par le serveur. */
export async function testerPush(): Promise<string> {
  const r = await navigator.serviceWorker?.getRegistration();
  const a = await r?.pushManager.getSubscription();
  if (!a) return 'Cet appareil n’est pas abonné aux notifications push.';
  const d = await poster('/test', { abonnement: a.toJSON() });
  return d.resultat === 'ok' ? 'Notification de test envoyée par le serveur.' : `Échec de l’envoi (${d.resultat ?? d.erreur ?? 'inconnu'}).`;
}
