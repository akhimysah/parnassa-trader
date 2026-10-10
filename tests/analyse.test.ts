import { describe, expect, it } from 'vitest';
import type { Bougie } from '../src/marche/bougies';
import { calculer, calculerTous, moyenne, panneauxIndicateurs, type Indicateur } from '../src/graphique/indicateurs';
import { heikin } from '../src/graphique/heikin';
import { evaluateur, deciderPerso, nouvelExpertPerso } from '../src/algo/assistant';
import { evaluerAlertes } from '../src/alertes';
import { lancerTest, nombreCombinaisons, optimiserGenetique } from '../src/algo/testeur';
import { symbole } from '../src/marche/symboles';
import { interpreter } from '../src/composants/NavigationRapide';
import { reglagesModele } from '../src/modeles';
import type { Alerte } from '../src/etat';

/** Série déterministe : une sinusoïde autour de 80 000, une barre par heure. */
function serie(n = 600): Bougie[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 80000 + 2000 * Math.sin(i / 25) + 300 * Math.sin(i / 3);
    const o = 80000 + 2000 * Math.sin((i - 1) / 25) + 300 * Math.sin((i - 1) / 3);
    return { time: 1_700_000_000 + i * 3600, open: o, high: Math.max(o, c) + 50, low: Math.min(o, c) - 50, close: c, volume: 10 };
  });
}
const ind = (type: Indicateur['type'], p: Record<string, number>, extra: Partial<Indicateur> = {}): Indicateur => ({ id: type, type, p, couleur: '', ...extra });

describe('indicateurs', () => {
  it('calcule moyennes simple et exponentielle', () => {
    const v = [1, 2, 3, 4, 5];
    expect(moyenne(v, 3, 'sma')).toEqual([null, null, 2, 3, 4]);
    expect(moyenne(v, 3, 'ema')[4]).toBeCloseTo(4, 6);
  });
  it('borne le RSI entre 0 et 100', () => {
    const r = calculer(ind('rsi', { periode: 14 }), serie()).traces[0].valeurs.filter((x): x is number => x !== null);
    expect(r.length).toBeGreaterThan(500);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...r)).toBeLessThanOrEqual(100);
  });
  it("applique un indicateur aux données du précédent, dans sa fenêtre", () => {
    const liste = [ind('rsi', { periode: 14 }), ind('ma', { periode: 9, decalage: 0 }, { source: 'precedent' }), ind('ma', { periode: 20, decalage: 0 })];
    expect(panneauxIndicateurs(liste)).toEqual([1, 1, 0]);
    const [rsi, maRsi] = calculerTous(liste, serie());
    const v = maRsi.resultat.traces[0].valeurs[300]!;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
    expect(rsi.panneau).toBe(1);
  });
  it('construit des bougies Heikin Ashi cohérentes', () => {
    const b = serie(50);
    const h = heikin(b);
    expect(h[10].close).toBeCloseTo((b[10].open + b[10].high + b[10].low + b[10].close) / 4, 6);
    expect(h[10].open).toBeCloseTo((h[9].open + h[9].close) / 2, 6);
    expect(h[10].high).toBeGreaterThanOrEqual(Math.max(h[10].open, h[10].close));
  });
});

describe('assistant et alertes', () => {
  it('repère un croisement de moyennes', () => {
    const b = serie();
    const croisements = b.slice(60).filter((_, i) => evaluateur(b.slice(0, 61 + i))({ a: { type: 'indicateur', indicateur: 'ma', p: { periode: 5, decalage: 0 }, trace: 0 }, op: 'croise-dessus', b: { type: 'indicateur', indicateur: 'ma', p: { periode: 20, decalage: 0 }, trace: 0 } }));
    expect(croisements.length).toBeGreaterThan(3);
  });
  it("décide comme l'expert par défaut de l'assistant", () => {
    const d = deciderPerso(nouvelExpertPerso('x'), serie(), null);
    expect(['buy', 'sell', null]).toContain(d.ouvrir);
  });
  it("répète une alerte avec pause puis la désactive, et désactive l'alerte expirée", () => {
    const q = { BTCUSD: { bid: 80000, ask: 80010, haut: 0, bas: 0, ouverture: 0, heure: 0, sens: 0 as const } };
    let a: Alerte[] = [
      { id: '1', symbole: 'BTCUSD', condition: 'bid>', valeur: 1, active: true, commentaire: '', max: 2, pause: 10 },
      { id: '2', symbole: 'BTCUSD', condition: 'bid>', valeur: 1, active: true, commentaire: '', expiration: 1 },
    ];
    const r1 = evaluerAlertes(a, q, 1000);
    expect(r1.declenchees.map((d) => d.alerte.id)).toEqual(['1']);
    a = r1.alertes;
    expect(evaluerAlertes(a, q, 5000).declenchees).toHaveLength(0);
    const r3 = evaluerAlertes(a, q, 12000);
    expect(r3.declenchees).toHaveLength(1);
    expect(r3.alertes.find((x) => x.id === '1')!.active).toBe(false);
    expect(r3.alertes.find((x) => x.id === '2')!.active).toBe(false);
  });
});

describe('testeur de stratégie', () => {
  const base = { s: symbole('BTCUSD')!, bougies: serie(), depot: 10000, levier: 100, spread: 1000, modelisation: 'ohlc' as const, conversion: 1 };
  const expert = { type: 'croisement-ma' as const, p: { rapide: 10, lente: 30, volume: 0.1, sl: 0, tp: 0, suiveur: 0, equilibre: 0 }, magic: 1 };
  it('produit des trades et un solde cohérent', () => {
    const r = lancerTest({ ...base, expert });
    expect(r.stats.trades).toBeGreaterThan(5);
    const dernier = r.transactions[r.transactions.length - 1];
    expect(dernier.solde).toBeCloseTo(10000 + r.stats.net, 2);
  });
  it("ne trade pas avant la barre de départ (avant-test)", () => {
    const r = lancerTest({ ...base, expert, debut: 400 });
    const premier = r.transactions.find((t) => t.type !== 'balance');
    expect(premier!.heure).toBeGreaterThanOrEqual(base.bougies[400].time * 1000);
  });
  it("trouve des réglages par l'algorithme génétique sans tout tester", async () => {
    const plages = { rapide: { debut: 2, pas: 1, fin: 40 }, lente: { debut: 10, pas: 2, fin: 120 } };
    expect(nombreCombinaisons(plages)).toBe(39 * 56);
    const passes = await optimiserGenetique({ ...base, expert }, plages, (p) => (p.trades ? p.profit : -Infinity), () => {}, () => false, undefined, 12, 6);
    expect(passes.length).toBeGreaterThan(10);
    expect(passes.length).toBeLessThan(nombreCombinaisons(plages));
  });
});

describe('utilitaires', () => {
  it('comprend la navigation rapide', () => {
    expect(interpreter('gbpusd,h4')).toEqual({ symbole: 'GBPUSD', periode: 'H4' });
    expect(interpreter('M15')).toEqual({ periode: 'M15' });
    expect(interpreter('xag')).toEqual({ symbole: 'XAGUSD' });
    expect(interpreter('zzz')).toBeNull();
  });
  it('donne de nouveaux identifiants aux indicateurs d’un modèle', () => {
    const r = reglagesModele({ nom: 'm', reglages: { indicateurs: [ind('rsi', { periode: 14 })] } });
    expect(r.indicateurs![0].id).not.toBe('rsi');
  });
});

describe('boîte aux lettres', () => {
  it('ajoute un relevé pour chaque jour de trading passé, pas pour aujourd’hui', async () => {
    const { messagesCompte } = await import('../src/courrier');
    const { nouveauCompte } = await import('../src/compte/moteur');
    const c = nouveauCompte('t', 10000, 100);
    const hier = Date.now() - 86400000;
    const sortie = (heure: number, profit: number) => ({ ticket: heure, ordre: 0, position: 1, heure, symbole: 'EURUSD', type: 'sell' as const, entree: 'out' as const, volume: 0.1, prix: 1, commission: 0, swap: 0, profit, solde: 10000 + profit, commentaire: '' });
    c.transactions.push(sortie(hier, 50), sortie(hier + 1000, -20), sortie(Date.now(), 10));
    const releves = messagesCompte(c).filter((m) => m.id.startsWith('releve-'));
    expect(releves).toHaveLength(1);
    expect(releves[0].titre).toContain('+30,00');
    expect(releves[0].texte).toContain('Trades fermés : 2');
  });
});

describe('indicateurs par formule', () => {
  it('calcule une formule et plusieurs courbes', async () => {
    const { calculerFormule, erreurFormule } = await import('../src/graphique/formule');
    const b = serie(200);
    const [diff] = calculerFormule('ema(close, 20) - ema(close, 50)', b);
    const e20 = moyenne(b.map((x) => x.close), 20, 'ema');
    const e50 = moyenne(b.map((x) => x.close), 50, 'ema');
    expect(diff[150]).toBeCloseTo(e20[150]! - e50[150]!, 6);
    const [haut, bas] = calculerFormule('highest(high, 20) ; lowest(low, 20)', b);
    expect(haut[100]!).toBeGreaterThan(bas[100]!);
    expect(calculerFormule('2 * (close - shift(close, 1))', b)[0][10]).toBeCloseTo(2 * (b[10].close - b[9].close), 6);
    expect(erreurFormule('ema(close, 20) - ')).not.toBeNull();
    expect(erreurFormule('foo(close)')).toMatch(/inconnue/);
    expect(erreurFormule('rsi(close, 14) - 50')).toBeNull();
  });
  it('se range dans la bonne fenêtre', () => {
    const f = (superposeFormule: boolean) => ({ id: 'f', type: 'formule' as const, p: {}, couleur: '', formule: 'sma(close, 5)', superposeFormule });
    expect(panneauxIndicateurs([f(true), f(false)])).toEqual([0, 1]);
    expect(calculer(f(false), serie(50)).traces[0].valeurs[20]).not.toBeNull();
  });
});

describe('formules dans les conditions', () => {
  it('compare une formule à une valeur', () => {
    const b = serie(200);
    const vraie = evaluateur(b);
    expect(vraie({ a: { type: 'formule', formule: 'close - close' }, op: 'inferieur', b: { type: 'valeur', valeur: 1 } })).toBe(true);
    expect(vraie({ a: { type: 'formule', formule: 'close - close' }, op: 'superieur', b: { type: 'valeur', valeur: 1 } })).toBe(false);
    expect(vraie({ a: { type: 'formule', formule: 'pas une formule (' }, op: 'superieur', b: { type: 'valeur', valeur: -1 } })).toBe(false);
  });
});

describe('scanner', () => {
  it('évalue toutes les recherches prêtes sans erreur, et certaines sont vraies', async () => {
    const { MODELES } = await import('../src/composants/Scanner');
    const b = serie(600);
    let vraies = 0;
    for (let i = 300; i < 600; i += 7) {
      const v = evaluateur(b.slice(0, i));
      for (const [, c] of MODELES) if (v(c)) vraies++;
    }
    expect(vraies).toBeGreaterThan(10);
  });
});

describe('indicateurs MT5 complémentaires', () => {
  it('calcule AMA, FrAMA, VIDYA, TRIX, A/D, Chaikin, Gator et BW MFI', () => {
    const b = serie(300);
    const types: [Indicateur['type'], Record<string, number>][] = [
      ['ama', { periode: 9, rapide: 2, lente: 30 }],
      ['frama', { periode: 14 }],
      ['vidya', { cmo: 9, ema: 12 }],
      ['trix', { periode: 14 }],
      ['ad', {}],
      ['chaikin', { rapide: 3, lente: 10 }],
      ['gator', { machoire: 13, dents: 8, levres: 5 }],
      ['bwmfi', {}],
    ];
    for (const [t, p] of types) {
      const v = calculer(ind(t, p), b).traces[0].valeurs;
      expect(v[250], t).not.toBeNull();
      expect(Number.isFinite(v[250]!), t).toBe(true);
    }
    // Les moyennes adaptatives restent dans la fourchette des prix.
    for (const t of ['ama', 'frama', 'vidya'] as const) {
      const x = calculer(ind(t, types.find(([k]) => k === t)![1]), b).traces[0].valeurs[250]!;
      expect(x).toBeGreaterThan(77000);
      expect(x).toBeLessThan(83000);
    }
  });
});

describe('filtres de l’assistant', () => {
  it('n’ouvre pas hors des heures ou dans le sens interdit', () => {
    const toujours: import('../src/algo/assistant').Condition = { a: { type: 'valeur', valeur: 1 }, op: 'superieur', b: { type: 'valeur', valeur: 0 } };
    const e = { ...nouvelExpertPerso('f'), achat: [toujours], vente: [] };
    const b = serie(100);
    expect(deciderPerso(e, b, null).ouvrir).toBe('buy');
    expect(deciderPerso({ ...e, sens: 'vente' }, b, null).ouvrir).toBeNull();
    const h = new Date(b[b.length - 1].time * 1000).getHours();
    expect(deciderPerso({ ...e, heures: [(h + 1) % 24, (h + 2) % 24 || 24] }, b, null).ouvrir).toBeNull();
    expect(deciderPerso({ ...e, heures: [h, h + 1] }, b, null).ouvrir).toBe('buy');
  });
});

describe('modélisation du testeur', () => {
  it('suit les bougies 1 minute et génère des ticks entre leurs points', async () => {
    const { cheminPrix } = await import('../src/algo/testeur');
    const barre = { time: 0, open: 1.1, high: 1.105, low: 1.095, close: 1.102, volume: 0 };
    const m1 = [
      { time: 0, open: 1.1, high: 1.105, low: 1.0995, close: 1.104, volume: 0 },
      { time: 60, open: 1.104, high: 1.1045, low: 1.095, close: 1.102, volume: 0 },
    ];
    expect(cheminPrix(barre, [], 'ohlc', 0.00001, 5)).toEqual([1.1, 1.095, 1.105, 1.102]);
    expect(cheminPrix(barre, [], 'm1', 0.00001, 5)).toEqual([1.1, 1.095, 1.105, 1.102]);
    expect(cheminPrix(barre, m1, 'm1', 0.00001, 5)).toHaveLength(8);
    const ticks = cheminPrix(barre, m1, 'ticks', 0.00001, 5);
    expect(ticks.length).toBeGreaterThan(8);
    expect(Math.min(...ticks)).toBe(1.095);
    expect(Math.max(...ticks)).toBe(1.105);
    // Aucun saut de plus d’un douzième de segment (à l’arrondi du point près).
    for (let i = 1; i < ticks.length; i++) expect(Math.abs(ticks[i] - ticks[i - 1])).toBeLessThanOrEqual(0.0095 / 12 + 0.00001);
  });
});

describe('MQL Parnassa', () => {
  const barres = (closes: number[]) => closes.map((c, k) => ({ time: 1_700_000_000 + k * 3600, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));
  it('compile les entrées et signale les erreurs avec la ligne', async () => {
    const { compiler, verifierScript, EXEMPLE_SCRIPT } = await import('../src/algo/script');
    expect(compiler(EXEMPLE_SCRIPT).entrees.map((e) => e.nom)).toEqual(['rapide', 'lente', 'filtre']);
    expect(compiler(EXEMPLE_SCRIPT).entrees[0].libelle).toBe('Période de la moyenne rapide');
    expect(verifierScript(EXEMPLE_SCRIPT)).toBeNull();
    expect(verifierScript('x = sma(close, 5)\nif x > then buy')).toMatch(/^ligne 2/);
    expect(verifierScript('if close > 1 then acheter')).toMatch(/action inconnue/);
    expect(verifierScript('x = 1')).toMatch(/aucune instruction/);
  });
  it('décide sur la dernière barre avec les entrées choisies', async () => {
    const { executerScript } = await import('../src/algo/script');
    const src = 'input seuil = 10\nif close > seuil and not (position > 0) then close sell; buy\nif position > 0 and close < seuil then close buy';
    const b = barres([5, 6, 12]);
    expect(executerScript(src, b, null)).toMatchObject({ ouvrir: 'buy', fermer: ['sell'] });
    expect(executerScript(src, b, 'buy').ouvrir).toBeNull();
    expect(executerScript(src, b, null, { seuil: 20 }).ouvrir).toBeNull();
    expect(executerScript(src, barres([12, 11, 8]), 'buy').fermer).toEqual(['buy']);
    const croise = 'if crossover(close, 10) then buy';
    expect(executerScript(croise, barres([9, 9.5, 11]), null).ouvrir).toBe('buy');
    expect(executerScript(croise, barres([9, 11, 12]), null).ouvrir).toBeNull();
  });
  it('rend les entrées optimisables comme paramètres de l’expert', async () => {
    const { definirExpertsPerso, definitionExpert } = await import('../src/algo/experts');
    const { EXEMPLE_SCRIPT } = await import('../src/algo/script');
    definirExpertsPerso([{ id: 's1', nom: 'Script', achat: [], vente: [], sortieAchat: [], sortieVente: [], script: EXEMPLE_SCRIPT }]);
    const d = definitionExpert('perso:s1');
    expect(d.defaut).toMatchObject({ rapide: 10, lente: 30, filtre: 50, volume: 0.1 });
    expect(d.libelles.lente).toBe('Période de la moyenne lente');
    definirExpertsPerso([]);
  });
});
