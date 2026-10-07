import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { capturerJetonDepuisAdresse } from './synchro';
import './installation';

// Retour de la page de consentement Parnassa : le jeton arrive dans le fragment de l'adresse.
capturerJetonDepuisAdresse();

createRoot(document.getElementById('racine')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Application installable (ordinateur et téléphone) : le service worker n'est actif qu'en production.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined));
}
