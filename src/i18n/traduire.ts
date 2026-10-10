/**
 * Interface en anglais : le terminal est écrit en français et ses textes affichés sont traduits à la volée, par
 * correspondance exacte avec un dictionnaire (src/i18n/en.ts), puis par motifs pour les textes qui contiennent des
 * valeurs. Un observateur du document traduit chaque texte, infobulle et indication de champ dès qu'il apparaît ou
 * change, sans toucher au code des composants. Les noms de symboles, prix et le code du MetaEditor restent tels quels.
 */
export type Langue = 'fr' | 'en';

const CLE = 'parnassa-trader:langue';

export function langueChoisie(): Langue {
  try {
    const v = localStorage.getItem(CLE);
    if (v === 'fr' || v === 'en') return v;
  } catch {
    // stockage indisponible
  }
  return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('fr') ? 'en' : 'fr';
}

/** Change la langue : la page est rechargée pour repartir des textes d'origine. */
export function changerLangue(l: Langue) {
  try {
    localStorage.setItem(CLE, l);
  } catch {
    // stockage indisponible : la langue suit celle du navigateur
  }
  location.reload();
}

/** Actifs et devises des descriptions « A vs B » des symboles. */
const ACTIFS: Record<string, string> = {
  'Dollar US': 'US Dollar',
  'Dollar australien': 'Australian Dollar',
  'Dollar canadien': 'Canadian Dollar',
  'Dollar néo-zélandais': 'New Zealand Dollar',
  'Franc suisse': 'Swiss Franc',
  'Livre sterling': 'Pound Sterling',
  'Yen japonais': 'Japanese Yen',
  Or: 'Gold',
  Argent: 'Silver',
  Platine: 'Platinum',
};

type Motif = [RegExp, (m: RegExpExecArray, t: (s: string) => string) => string];

/** Textes avec des valeurs : messages du moteur, compteurs, libellés « Nom : valeur ». */
const MOTIFS: Motif[] = [
  [/^([\d\s ]+) dernières barres$/, (m) => `Last ${m[1]} bars`],
  [/^Analyse (\d+) \/ (\d+)…$/, (m) => `Scanning ${m[1]} / ${m[2]}…`],
  [/^Ordre #(\d+) exécuté : (.*)$/, (m, t) => `Order #${m[1]} filled: ${t(m[2])}`],
  [/^Ordre #(\d+) (.+) expiré$/, (m) => `Order #${m[1]} ${m[2]} expired`],
  [/^Ordre #(\d+) (.+) rejeté : (.*)$/, (m, t) => `Order #${m[1]} ${m[2]} rejected: ${t(m[3])}`],
  [/^Stop Loss #(\d+) : (.*)$/, (m, t) => `Stop Loss #${m[1]}: ${t(m[2])}`],
  [/^Take Profit #(\d+) : (.*)$/, (m, t) => `Take Profit #${m[1]}: ${t(m[2])}`],
  [/^(.*), profit (-?[\d.]+) (USD|EUR)$/, (m, t) => `${t(m[1])}, profit ${m[2]} ${m[3]}`],
  [/^achat au marché (?:buy )?(.*)$/, (m) => `market buy ${m[1]}`],
  [/^vente au marché (?:sell )?(.*)$/, (m) => `market sell ${m[1]}`],
  [/^exécuté, deal #(\d+) (.*)$/, (m) => `done, deal #${m[1]} ${m[2].replace(' à ', ' at ')}`],
  [/^Alerte (\S+) : (.*)$/, (m, t) => `Alert ${m[1]}: ${t(m[2])}`],
  [/^(\d+) trades?, bénéfice net (.*)$/, (m) => `${m[1]} trades, net profit ${m[2]}`],
  [/^Historique 1 minute : (.*) bougies…$/, (m) => `1-minute history: ${m[1]} bars…`],
  [/^Test multi-symboles : (\S+) \((\d+) \/ (\d+)\)$/, (m) => `Multi-symbol test: ${m[1]} (${m[2]} / ${m[3]})`],
  [/^(.+) attaché à (\S+) \(activez l'Algo Trading pour qu'il trade\)$/, (m) => `${m[1]} attached to ${m[2]} (enable Algo Trading to let it trade)`],
  [/^(.+) vs (.+)$/, (m) => `${ACTIFS[m[1]] ?? m[1]} vs ${ACTIFS[m[2]] ?? m[2]}`],
  [/^(.+) · marge (.+)$/, (m) => `${m[1]} · margin ${m[2]}`],
  [/^ligne (\d+) : (.*)$/, (m, t) => `line ${m[1]}: ${t(m[2])}`],
  [/^(buy|sell)( .+) à (-?[\d.]+)$/, (m) => `${m[1]}${m[2]} at ${m[3]}`],
  [/^Connecté — (\d+) ms$/, (m) => `Connected — ${m[1]} ms`],
  [/^Server (\S+)\. Appel de marge à (\d+) %, stop-out à (\d+) %\.$/, (m) => `Server ${m[1]}. Margin call at ${m[2]} %, stop out at ${m[3]} %.`],
  [/^Aujourd'hui sur (\d+) : perte de (.+) \((.+)\) depuis un solde de départ de (.+)\.$/, (m) => `Today on ${m[1]}: loss of ${m[2]} (${m[3]}) from a starting balance of ${m[4]}.`],
  [/^Expert MQL Parnassa \((\d+) instructions\)(.*)$/, (m, t) => `MQL Parnassa Expert (${m[1]} statements)${m[2].replace(/Modifiable dans le MetaEditor \(F4\)\./, 'Edit it in the MetaEditor (F4).').replace(/^ : /, ': ')}`],
  // « 64234045 : Compte démo », « EURUSD, Euro vs Dollar US » : numéro ou symbole, puis un texte.
  [/^(\d+) : (.+)$/, (m, t) => `${m[1]}: ${t(m[2])}`],
  [/^([A-Z0-9]{2,10}), (.+)$/, (m, t) => `${m[1]}, ${t(m[2])}`],
];

/** Règles génériques : segments « A — B », texte suivi d'une parenthèse « Actuel (12 points) ». */
function parSegments(texte: string): string | null {
  if (texte.includes(' — ')) {
    const parties = texte.split(' — ');
    const r = parties.map((x) => traduireTexte(x) ?? x);
    return r.some((x, k) => x !== parties[k]) ? r.join(' — ') : null;
  }
  const m = /^(.+?) \(([^()]*)\)$/.exec(texte);
  if (m) {
    const tete = traduireTexte(m[1]);
    const dedans = traduireTexte(m[2]);
    if (tete !== null || dedans !== null) return `${tete ?? m[1]} (${(dedans ?? m[2]).replace(/^(\d+) points$/, '$1 points')})`;
  }
  return null;
}

let dico: Record<string, string> = {};

/** Dictionnaire utilisé par traduireTexte (posé par demarrerTraduction ; exporté pour les tests). */
export function definirDictionnaire(d: Record<string, string>) {
  dico = d;
}

/** Traduit un texte (sans les espaces autour) ; renvoie null s'il n'y a pas de traduction. */
export function traduireTexte(texte: string): string | null {
  const direct = dico[texte];
  if (direct !== undefined) return direct;
  for (const [re, f] of MOTIFS) {
    const m = re.exec(texte);
    if (m) return f(m, (s) => traduireTexte(s) ?? s);
  }
  // « Libellé : valeur » ou « Libellé : » : seul le libellé est traduit.
  const m = /^(.+?)(\s?:\s*)(.*)$/s.exec(texte);
  if (m && dico[m[1]] !== undefined) return `${dico[m[1]]}:${m[3] ? ` ${traduireTexte(m[3]) ?? m[3]}` : ''}`;
  const segments = parSegments(texte);
  if (segments !== null) return segments;
  // « Parnassa-Demo : Démo Standard » : seule la valeur se traduit.
  const valeur = m && m[3] ? traduireTexte(m[3]) : null;
  return m && valeur !== null ? `${m[1]}${m[2]}${valeur}` : null;
}

const ATTRIBUTS = ['title', 'placeholder', 'aria-label'];
const EXCLUS = 'script, style, textarea, .metaediteur-code, [data-sans-traduction]';

/** Dernière valeur écrite par la traduction : la mutation qu'elle provoque est ignorée. */
const ecrits = new WeakMap<Node, string>();

function traduireNoeudTexte(n: Text) {
  const v = n.nodeValue;
  if (!v || ecrits.get(n) === v || !/[a-zà-ÿ]{2}/i.test(v)) return;
  const parent = n.parentElement;
  if (!parent || parent.closest(EXCLUS)) return;
  const t = v.trim();
  const r = traduireTexte(t);
  if (r === null || r === t) return;
  const nouveau = v.replace(t, r);
  ecrits.set(n, nouveau);
  n.nodeValue = nouveau;
}

/**
 * Texte de React découpé en plusieurs nœuds (« {n} dernières barres » → « 500 » + « dernières barres ») : traduit
 * d'un bloc dans le premier nœud, les autres vidés.
 */
function traduireMorceaux(e: Element) {
  const noeuds = [...e.childNodes];
  if (noeuds.length < 2 || !noeuds.every((n) => n.nodeType === Node.TEXT_NODE)) return;
  const v = noeuds.map((n) => n.nodeValue ?? '').join('');
  if (noeuds.every((n) => ecrits.get(n) === n.nodeValue) || !/[a-zà-ÿ]{2}/i.test(v)) return;
  const t = v.trim();
  const r = traduireTexte(t);
  if (r === null || r === t) return;
  noeuds.forEach((n, k) => {
    const nouveau = k === 0 ? v.replace(t, r) : '';
    ecrits.set(n, nouveau);
    n.nodeValue = nouveau;
  });
}

function traduireElement(e: Element) {
  if (e.closest(EXCLUS)) return;
  traduireMorceaux(e);
  for (const a of ATTRIBUTS) {
    const v = e.getAttribute(a);
    if (!v) continue;
    const r = traduireTexte(v.trim());
    if (r !== null && r !== v) e.setAttribute(a, r);
  }
}

function parcourir(racine: Node) {
  if (racine.nodeType === Node.TEXT_NODE) return traduireNoeudTexte(racine as Text);
  if (racine.nodeType !== Node.ELEMENT_NODE) return;
  traduireElement(racine as Element);
  const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) traduireNoeudTexte(n as Text);
    else traduireElement(n as Element);
  }
}

/** Démarre la traduction du document entier (avant le premier rendu de React). */
export function demarrerTraduction(dictionnaire: Record<string, string>) {
  dico = dictionnaire;
  document.documentElement.lang = 'en';
  const observateur = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        traduireNoeudTexte(m.target as Text);
        if (m.target.parentElement) traduireMorceaux(m.target.parentElement);
      }
      else if (m.type === 'attributes') traduireElement(m.target as Element);
      else m.addedNodes.forEach(parcourir);
    }
  });
  observateur.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTS });
  parcourir(document.body);
  // Titre de l'onglet (« EURUSD,H1 — Parnassa Trader » reste tel quel, les autres sont traduits).
  const titre = document.querySelector('title');
  if (titre) new MutationObserver(() => {
    const r = traduireTexte(document.title);
    if (r && r !== document.title) document.title = r;
  }).observe(titre, { childList: true, characterData: true, subtree: true });
}
