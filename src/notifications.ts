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
