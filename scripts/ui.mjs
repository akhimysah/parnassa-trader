// Tests d'interface : le terminal compilé est ouvert dans un vrai navigateur (le Google Chrome de cette machine),
// sur un état neuf (compte de démonstration), et chaque scénario est joué comme par un utilisateur : ouvrir un
// ordre, le voir dans la Boîte à outils puis le fermer, lancer le testeur, compiler un expert, ouvrir le DOM, passer
// en anglais, l'écran mobile, une fenêtre détachée. Une erreur JavaScript ou un débordement horizontal fait échouer.
// Les cotations viennent du vrai réseau (Binance, relais Parnassa) : une connexion internet est nécessaire.
// Usage : pnpm ui   (pnpm build:pages d'abord n'est pas nécessaire : le script compile lui-même)
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

async function portLibre(debut) {
  for (let p = debut; p < debut + 50; p++) {
    const libre = await new Promise((ok) => {
      const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)));
      s.listen(p, '127.0.0.1');
    });
    if (libre) return p;
  }
  throw new Error('Aucun port libre.');
}

let reussis = 0;
const echecs = [];
function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussis++;
    console.log(`OK    ${libelle}`);
  } else {
    echecs.push(libelle);
    console.log(`ÉCHEC ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('Compilation…');
execSync('corepack pnpm exec vite build --logLevel error', { stdio: 'inherit', env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } });
const port = await portLibre(5260);
const serveur = spawn('corepack', ['pnpm', 'exec', 'vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } });
const APP = `http://localhost:${port}`;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(APP)).ok) break;
  } catch {
    // pas encore prêt
  }
  await new Promise((ok) => setTimeout(ok, 300));
}

const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Nouvelle page sur un état neuf ; les erreurs JavaScript sont relevées. */
async function page(options = {}, url = '/?interface=bureau', avant) {
  const contexte = await navigateur.newContext({ viewport: { width: 1366, height: 820 }, locale: 'fr-FR', ...options });
  if (avant) await contexte.addInitScript(avant);
  const p = await contexte.newPage();
  const erreurs = [];
  p.on('pageerror', (e) => erreurs.push(e.message));
  await p.goto(`${APP}${url}`);
  return { p, erreurs, contexte };
}
const debordement = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function scenario(nom, f) {
  try {
    await f();
  } catch (e) {
    verifier(nom, false, e instanceof Error ? e.message.split('\n')[0] : String(e));
  }
}

await scenario('bureau', async () => {
  const { p, erreurs, contexte } = await page();
  await p.getByText('Observation du marché').first().waitFor({ timeout: 15000 });
  verifier('bureau : Observation du marché, Navigateur et Boîte à outils affichés', (await p.getByText('Navigateur').count()) > 0 && (await p.locator('.onglets-bas').count()) > 0);
  await p.waitForFunction(() => /\d/.test(document.querySelector('.prix')?.textContent ?? ''), null, { timeout: 20000 });
  verifier('bureau : cotations reçues', true);
  verifier('bureau : graphique dessiné', (await p.locator('canvas').count()) > 0);
  verifier('bureau : aucun débordement horizontal', (await debordement(p)) <= 0);
  verifier('bureau : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('ordre', async () => {
  const { p, erreurs, contexte } = await page();
  await p.getByText('Observation du marché').first().waitFor();
  await p.keyboard.press('F9');
  const fenetre = p.locator('.fenetre').filter({ hasText: 'Achat au marché' });
  await fenetre.waitFor();
  await fenetre.locator('select').first().selectOption('BTCUSD');
  const acheter = fenetre.getByRole('button', { name: 'Achat au marché' });
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Achat au marché' && !b.disabled), null, { timeout: 20000 });
  await acheter.click();
  await p.getByText('✔').waitFor();
  await p.getByRole('button', { name: 'OK' }).click();
  const ligne = p.locator('.onglet-trading tbody tr').filter({ hasText: 'BTCUSD' });
  await ligne.first().waitFor();
  verifier('ordre : achat BTCUSD au marché visible dans Trading', (await ligne.count()) === 1);
  await ligne.first().getByTitle('Fermer la position').click();
  await p.waitForFunction(() => ![...document.querySelectorAll('.onglet-trading tbody tr')].some((r) => r.textContent?.includes('BTCUSD')));
  verifier('ordre : position fermée depuis la Boîte à outils', true);
  verifier('ordre : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('testeur', async () => {
  const { p, erreurs, contexte } = await page();
  await p.getByText('Observation du marché').first().waitFor();
  await p.keyboard.press('Control+r');
  const demarrer = p.getByRole('button', { name: /Démarrer/ });
  await demarrer.waitFor();
  await p.locator('.testeur-parametres select').nth(1).selectOption('BTCUSD');
  await demarrer.click();
  // Fin du test : le testeur passe de lui-même sur l'onglet Backtest et montre le rapport.
  await p.getByText('Bénéfice net').first().waitFor({ timeout: 90000 });
  verifier('testeur : rapport sur BTCUSD', /BTCUSD, H1/.test(await p.locator('body').innerText()));
  verifier('testeur : backtest BTCUSD terminé avec son rapport', true);
  verifier('testeur : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('metaeditor', async () => {
  const { p, erreurs, contexte } = await page();
  await p.getByText('Observation du marché').first().waitFor();
  await p.keyboard.press('F4');
  await p.locator('.fenetre-metaediteur').waitFor();
  await p.keyboard.press('F7');
  verifier("metaeditor : l'exemple compile sans erreur", /0 erreur/.test(await p.locator('.metaediteur-sortie').innerText()));
  await p.locator('.metaediteur-code textarea').fill('if macd(close) > 0 then buy');
  await p.keyboard.press('F7');
  verifier('metaeditor : erreur signalée avec sa ligne', /ligne 1/.test(await p.locator('.metaediteur-sortie').innerText()));
  verifier('metaeditor : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('dom', async () => {
  const { p, erreurs, contexte } = await page();
  await p.getByText('Observation du marché').first().waitFor();
  await p.waitForFunction(() => /\d/.test(document.querySelector('.prix')?.textContent ?? ''), null, { timeout: 20000 });
  await p.keyboard.press('Alt+b');
  const dom = p.locator('.fenetre-dom');
  await dom.waitFor();
  await p.waitForFunction(() => document.querySelectorAll('.fenetre-dom tr').length >= 20, null, { timeout: 20000 });
  verifier('dom : profondeur affichée hors crypto (EURUSD)', /liquidité indicative/.test(await dom.innerText()));
  verifier('dom : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('anglais', async () => {
  const { p, erreurs, contexte } = await page({}, '/?interface=bureau', () => localStorage.setItem('parnassa-trader:langue', 'en'));
  await p.getByText('Market Watch').first().waitFor({ timeout: 15000 });
  await p.keyboard.press('F9');
  await p.getByRole('button', { name: 'Market Buy' }).waitFor();
  verifier('anglais : Market Watch et fenêtre Order traduites', true);
  verifier('anglais : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('mobile', async () => {
  const { p, erreurs, contexte } = await page({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '/?interface=mobile');
  // Écran de bienvenue d'un premier lancement.
  await p.getByRole('button', { name: 'Passer' }).click({ timeout: 15000 }).catch(() => undefined);
  await p.getByText('Cotations').first().waitFor({ timeout: 15000 });
  verifier('mobile : écran Cotations sans débordement horizontal', (await debordement(p)) <= 0);
  for (const onglet of ['Graphique', 'Trade', 'Historique', 'Paramètres']) {
    await p.locator('nav.mm-onglets button', { hasText: onglet }).click();
    await pause(400);
    verifier(`mobile : onglet ${onglet} sans débordement`, (await debordement(p)) <= 0);
  }
  verifier('mobile : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await scenario('detache', async () => {
  const { p, contexte } = await page();
  await p.getByText('Observation du marché').first().waitFor();
  await p.reload(); // l'état est enregistré en quittant la page
  await p.getByText('Observation du marché').first().waitFor();
  const id = await p.evaluate(() => JSON.parse(localStorage.getItem('parnassa-trader:v1') ?? '{}').graphiques?.[0]?.id);
  const autre = await contexte.newPage();
  const erreurs = [];
  autre.on('pageerror', (e) => erreurs.push(e.message));
  await autre.goto(`${APP}/?detache=${id}`);
  await autre.locator('.vue-detachee canvas').first().waitFor({ timeout: 15000 });
  verifier('fenêtre détachée : graphique affiché', Boolean(id));
  verifier('fenêtre détachée : aucune erreur JavaScript', erreurs.length === 0, erreurs[0]);
  await contexte.close();
});

await navigateur.close();
serveur.kill();
console.log(`\n${reussis} vérification(s) réussie(s), ${echecs.length} échec(s).`);
if (echecs.length) {
  console.log(echecs.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log('Tout est en ordre.');
