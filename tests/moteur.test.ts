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
