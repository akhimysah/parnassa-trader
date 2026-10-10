import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const VueDetachee = lazy(() => import('./VueDetachee').then((m) => ({ default: m.VueDetachee })));
import './styles.css';
import { capturerJetonDepuisAdresse } from './synchro';
import './installation';

// Retour de la page de consentement Parnassa : le jeton arrive dans le fragment de l'adresse.
capturerJetonDepuisAdresse();

// Fenêtre détachée (second écran) : un seul graphique, en affichage seul.
const detache = new URLSearchParams(window.location.search).get('detache');

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    {detache ? (
      <Suspense fallback={null}>
        <VueDetachee id={detache} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

// Application installable (ordinateur et téléphone) : le service worker n'est actif qu'en production.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined));
}
