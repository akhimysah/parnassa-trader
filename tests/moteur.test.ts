import { describe, expect, it } from 'vitest';
import { appliquerCotations, definirEquilibre, definirSuiveur, etatCompte, fermerPosition, nouveauCompte, ouvrirMarche, placerOrdre, type Compte } from '../src/compte/moteur';
import type { Cotation } from '../src/marche/cotations';

// La crypto cote 7 j / 7 : les tests ne dépendent pas de l'heure à laquelle ils tournent.
const cot = (bid: number, ecart = 10): Record<string, Cotation> => ({ BTCUSD: { bid, ask: bid + ecart, haut: bid, bas: bid, ouverture: bid, heure: Date.now(), sens: 0 } });
const acheter = (c: Compte, prix = 80000, sl = 0, tp = 0) => ouvrirMarche(c, { symbole: 'BTCUSD', type: 'buy', volume: 0.1, sl, tp, commentaire: '' }, cot(prix));

describe('moteur du compte', () => {
  it("achète à l'Ask, ferme au Bid et crédite le résultat", () => {
    let c = nouveauCompte('t', 10000, 100);
    const r = acheter(c);
    expect(r.erreur).toBeNull();
    c = r.compte;
    expect(c.positions[0].prixOuverture).toBe(80010);
    const f = fermerPosition(c, c.positions[0].ticket, cot(80110));
    expect(f.erreur).toBeNull();
    // (80110 - 80010) × 0,1 lot × 1 BTC
    expect(f.compte.solde).toBeCloseTo(10010, 2);
    expect(f.compte.positions).toHaveLength(0);
  });

  it('déclenche le stop-loss et le take-profit', () => {
    let c = acheter(nouveauCompte('t', 10000, 100), 80000, 79500, 81000).compte;
    c = appliquerCotations(c, cot(80500)).compte;
    expect(c.positions).toHaveLength(1);
    const sl = appliquerCotations(c, cot(79400));
    expect(sl.compte.positions).toHaveLength(0);
    expect(sl.evenements.some((e) => e.type === 'sl')).toBe(true);
    const tp = appliquerCotations(c, cot(81100));
    expect(tp.evenements.some((e) => e.type === 'tp')).toBe(true);
  });

  it('exécute un ordre limite quand le prix est atteint', () => {
    const r = placerOrdre(nouveauCompte('t', 10000, 100), { symbole: 'BTCUSD', type: 'buy_limit', volume: 0.1, prix: 79000, prixLimite: 0, sl: 0, tp: 0, expiration: 'gtc', echeance: 0, commentaire: '' }, cot(80000));
    expect(r.erreur).toBeNull();
    expect(appliquerCotations(r.compte, cot(79500)).compte.positions).toHaveLength(0);
    const a = appliquerCotations(r.compte, cot(78980));
    expect(a.compte.positions).toHaveLength(1);
    expect(a.compte.ordres).toHaveLength(0);
  });

  it('fait suivre le stop et passe au break-even', () => {
    let c = acheter(nouveauCompte('t', 10000, 100)).compte;
    const t = c.positions[0].ticket;
    c = definirSuiveur(c, t, 10000); // 100 $
    c = appliquerCotations(c, cot(80300)).compte;
    expect(c.positions[0].sl).toBeCloseTo(80200, 2);
    let d = acheter(nouveauCompte('t', 10000, 100)).compte;
    expect(definirEquilibre(d, d.positions[0].ticket, -1, cot(80000)).erreur).not.toBeNull();
    d = definirEquilibre(d, d.positions[0].ticket, 5000, cot(80000)).compte;
    d = appliquerCotations(d, cot(80100)).compte;
    expect(d.positions[0].sl).toBe(80010);
  });

  it('note le MFE et le MAE, et les reporte sur la sortie', () => {
    let c = acheter(nouveauCompte('t', 10000, 100)).compte;
    c = appliquerCotations(c, cot(80210)).compte;
    c = appliquerCotations(c, cot(79910)).compte;
    const f = fermerPosition(c, c.positions[0].ticket, cot(80010)).compte;
    const sortie = f.transactions[f.transactions.length - 1];
    expect(sortie.mfe).toBe(20000);
    expect(sortie.mae).toBe(-10000);
  });

  it('ferme la position la plus perdante au stop-out', () => {
    let c = nouveauCompte('t', 1000, 100);
    c = ouvrirMarche(c, { symbole: 'BTCUSD', type: 'buy', volume: 0.1, sl: 0, tp: 0, commentaire: '' }, cot(80000)).compte;
    expect(etatCompte(c, cot(80000)).marge).toBeGreaterThan(0);
    const r = appliquerCotations(c, cot(70000));
    expect(r.compte.positions).toHaveLength(0);
    expect(r.evenements.some((e) => e.type === 'stop-out')).toBe(true);
  });
});

describe('gestion du risque', () => {
  it('bloque au-delà du volume et du nombre de positions', async () => {
    const { refusRisque } = await import('../src/compte/risque');
    const c = nouveauCompte('t', 10000, 100);
    const gros = ouvrirMarche(c, { symbole: 'BTCUSD', type: 'buy', volume: 0.5, sl: 0, tp: 0, commentaire: '' }, cot(80000)).compte;
    expect(refusRisque(c, gros, { perteJourPct: 0, maxPositions: 0, maxVolume: 0.2, fermerAuSeuil: false }, cot(80000))).toMatch(/Volume limité/);
    const un = acheter(c).compte;
    const deux = acheter(un).compte;
    expect(refusRisque(un, deux, { perteJourPct: 0, maxPositions: 1, maxVolume: 0, fermerAuSeuil: false }, cot(80000))).toMatch(/1 positions/);
    // Fermer une position n'est jamais refusé.
    const ferme = fermerPosition(deux, deux.positions[0].ticket, cot(80000)).compte;
    expect(refusRisque(deux, ferme, { perteJourPct: 0, maxPositions: 1, maxVolume: 0, fermerAuSeuil: false }, cot(80000))).toBeNull();
  });
  it('bloque les nouveaux ordres et ferme tout à la perte du jour', async () => {
    const { refusRisque, appliquerLimiteJour, perteJour } = await import('../src/compte/risque');
    const regles = { perteJourPct: 2, maxPositions: 0, maxVolume: 0, fermerAuSeuil: true };
    const c = acheter(nouveauCompte('t', 10000, 100)).compte;
    // -2 500 $ de flottant sur 0,1 BTC : bien plus de 2 % des 10 000 $.
    expect(perteJour(c, cot(55000)).pct).toBeGreaterThan(2);
    expect(refusRisque(c, acheter(c, 55000).compte, regles, cot(55000))).toMatch(/Limite de perte du jour/);
    const r = appliquerLimiteJour(c, regles, cot(55000));
    expect(r.compte.positions).toHaveLength(0);
    expect(r.message).toMatch(/limite de perte du jour/);
    expect(appliquerLimiteJour(c, regles, cot(80000)).compte.positions).toHaveLength(1);
  });
});

describe('compte en compensation (netting)', () => {
  const compte = () => nouveauCompte('n', 100000, 100, 'standard', false, 'netting');
  const ordre = (c: Compte, type: 'buy' | 'sell', volume: number, prix: number) => ouvrirMarche(c, { symbole: 'BTCUSD', type, volume, sl: 0, tp: 0, commentaire: '' }, cot(prix));
  it('ajoute au même sens avec un prix moyen', () => {
    let c = ordre(compte(), 'buy', 0.1, 80000).compte;
    c = ordre(c, 'buy', 0.1, 81000).compte;
    expect(c.positions).toHaveLength(1);
    expect(c.positions[0].volume).toBe(0.2);
    expect(c.positions[0].prixOuverture).toBeCloseTo(80510, 2);
  });
  it('réduit, ferme puis retourne la position', () => {
    let c = ordre(compte(), 'buy', 0.3, 80000).compte;
    c = ordre(c, 'sell', 0.1, 80000).compte;
    expect(c.positions[0].volume).toBeCloseTo(0.2, 6);
    c = ordre(c, 'sell', 0.2, 80000).compte;
    expect(c.positions).toHaveLength(0);
    c = ordre(c, 'buy', 0.1, 80000).compte;
    c = ordre(c, 'sell', 0.25, 80000).compte;
    expect(c.positions).toHaveLength(1);
    expect(c.positions[0].type).toBe('sell');
    expect(c.positions[0].volume).toBeCloseTo(0.15, 6);
  });
  it('reste en couverture par défaut', () => {
    let c = acheter(nouveauCompte('h', 100000, 100)).compte;
    c = acheter(c).compte;
    expect(c.positions).toHaveLength(2);
  });
});
