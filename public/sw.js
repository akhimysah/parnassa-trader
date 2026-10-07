/* Service worker de Parnassa Trader : application installable, démarrage hors ligne, notifications. */
const VERSION = 'parnassa-trader-v1';
const COQUILLE = ['./', './index.html', './manifest.webmanifest', './icone.svg', './icone-192.png', './icone-512.png'];
const RELAIS = 'parnassa-actualites.neobank.workers.dev';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Toutes les pages de l'application partagent une seule copie (le # ne change pas le document). */
function cleDe(requete) {
  return requete.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : requete;
}

async function reseauPuisCache(requete) {
  const cache = await caches.open(VERSION);
  const cle = cleDe(requete);
  try {
    const reponse = await fetch(requete);
    if (reponse.ok) cache.put(cle, reponse.clone());
    return reponse;
  } catch (erreur) {
    const enCache = await cache.match(cle);
    if (enCache) return enCache;
    if (requete.mode === 'navigate') {
      const accueil = await cache.match('./index.html');
      if (accueil) return accueil;
    }
    throw erreur;
  }
}

/** Garde au plus 12 fichiers compilés (les plus récents) : les versions précédentes sont supprimées. */
async function elaguerAssets(cache) {
  const assets = (await cache.keys()).filter((r) => r.url.includes('/assets/'));
  for (const r of assets.slice(0, Math.max(0, assets.length - 12))) await cache.delete(r);
}

async function cachePuisReseau(requete) {
  const cache = await caches.open(VERSION);
  const enCache = await cache.match(requete);
  if (enCache) return enCache;
  const reponse = await fetch(requete);
  if (reponse.ok) {
    await cache.put(requete, reponse.clone());
    await elaguerAssets(cache);
  }
  return reponse;
}

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method !== 'GET') return;
  const url = new URL(requete.url);
  // Pages : réseau d'abord (toujours la dernière version), copie locale hors ligne.
  if (requete.mode === 'navigate' && url.origin === self.location.origin) {
    e.respondWith(reseauPuisCache(requete));
    return;
  }
  // Fichiers compilés (noms à empreinte) : immuables, servis depuis le cache.
  if (url.origin === self.location.origin && url.pathname.includes('/assets/')) {
    e.respondWith(cachePuisReseau(requete));
    return;
  }
  // Actualités, calendrier et bougies : réseau d'abord, dernière copie si hors ligne.
  if (url.hostname === RELAIS) {
    e.respondWith(reseauPuisCache(requete));
    return;
  }
  // Le reste (cotations Binance, Yahoo, scanner) passe directement au réseau.
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      for (const f of fenetres) {
        if ('focus' in f) {
          if (cible !== './' && 'navigate' in f) f.navigate(cible);
          return f.focus();
        }
      }
      return self.clients.openWindow(cible);
    }),
  );
});
