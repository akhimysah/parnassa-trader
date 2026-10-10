import { useEffect, useMemo, useState } from 'react';
import { useTerminal } from '../contexte';
import { etatCompte, fermerPosition, LIBELLES_TYPE, profitPosition, prixFermeture, supprimerOrdre, definirSuiveur, conversion, type Transaction } from '../compte/moteur';
import { formaterPrix, point, symbole } from '../marche/symboles';
import { RELAIS } from '../marche/bougies';
import { argent, dateMT, useMenuContextuel, type ElementMenu } from './ui';
import { enregistrerRapport, enteteCompte, rapportHtml } from '../algo/rapportHtml';
import { CONDITIONS } from '../alertes';

export type OngletBoite = 'trading' | 'exposition' | 'historique' | 'actualites' | 'courrier' | 'calendrier' | 'alertes' | 'journal';

export const ONGLETS_BOITE: [OngletBoite, string][] = [
  ['trading', 'Trading'],
  ['exposition', 'Exposition'],
  ['historique', 'Historique'],
  ['actualites', 'Actualités'],
  ['courrier', 'Boîte aux lettres'],
  ['calendrier', 'Calendrier'],
  ['alertes', 'Alertes'],
  ['journal', 'Journal'],
];

export function BoiteOutils({ onglet, changer }: { onglet: OngletBoite; changer: (o: OngletBoite) => void }) {
  const { maj, etat } = useTerminal();
  const nonLus = MESSAGES.filter((m) => !etat.lus.includes(m.id)).length;
  return (
    <div className="panneau boite">
      <div className="boite-poignee" title="Boîte à outils">
        <button onClick={() => maj((e) => ({ ...e, panneaux: { ...e.panneaux, boite: false } }))} aria-label="Fermer la boîte à outils">
          ✕
        </button>
        <span>Boîte à outils</span>
      </div>
      <div className="boite-contenu">
        <div className="panneau-corps">
          {onglet === 'trading' && <OngletTrading />}
          {onglet === 'exposition' && <OngletExposition />}
          {onglet === 'historique' && <OngletHistorique />}
          {onglet === 'actualites' && <OngletActualites />}
          {onglet === 'courrier' && <OngletCourrier />}
          {onglet === 'calendrier' && <OngletCalendrier />}
          {onglet === 'alertes' && <OngletAlertes />}
          {onglet === 'journal' && <OngletJournal />}
        </div>
        <div className="onglets-bas">
          {ONGLETS_BOITE.map(([id, l]) => (
            <button key={id} className={onglet === id ? 'actif' : ''} onClick={() => changer(id)}>
              {l}
              {id === 'courrier' && nonLus > 0 && <sup className="pastille">{nonLus}</sup>}
              {id === 'alertes' && etat.alertes.some((a) => a.active) && <sup className="pastille neutre">{etat.alertes.filter((a) => a.active).length}</sup>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Trading ----------

export function OngletTrading() {
  const { compte, cotations, operer, ouvrir } = useTerminal();
  const [enPoints, setEnPoints] = useState(false);
  const [choisi, setChoisi] = useState<number | null>(null);
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const e = etatCompte(compte, cotations);

  const menuTrading = (ev: React.MouseEvent, ticket?: number) => {
    ev.preventDefault();
    if (ticket) setChoisi(ticket);
    const p = compte.positions.find((x) => x.ticket === ticket);
    const o = compte.ordres.find((x) => x.ticket === ticket);
    const s = p ? symbole(p.symbole) : undefined;
    const elements: ElementMenu[] = [{ libelle: 'Nouvel ordre', raccourci: 'F9', action: () => ouvrir({ type: 'ordre', symbole: p?.symbole ?? o?.symbole }) }];
    if (p && s) {
      elements.push(
        { libelle: 'Fermer la position', action: () => operer((c) => fermerPosition(c, p.ticket, cotations)) },
        { libelle: 'Fermeture partielle…', action: () => ouvrir({ type: 'fermeture-partielle', ticket: p.ticket }) },
        { libelle: 'Modifier ou supprimer', action: () => ouvrir({ type: 'modifier-position', ticket: p.ticket }) },
        {
          libelle: 'Stop suiveur',
          sousMenu: [
            { libelle: 'Aucun', coche: p.suiveur === 0, action: () => operer((c) => ({ compte: definirSuiveur(c, p.ticket, 0), erreur: null }), { silencieux: true }) },
            { separateur: true },
            ...[15, 20, 25, 30, 50, 100, 200, 500].map((n) => ({
              libelle: `${n} points`,
              coche: p.suiveur === n,
              action: () => operer((c) => ({ compte: definirSuiveur(c, p.ticket, n), erreur: null }), { silencieux: true }),
            })),
            { separateur: true },
            { libelle: 'Personnalisé…', action: () => ouvrir({ type: 'suiveur', ticket: p.ticket }) },
          ],
        },
      );
    }
    if (o) {
      elements.push(
        { libelle: "Modifier l'ordre", action: () => ouvrir({ type: 'modifier-ordre', ticket: o.ticket }) },
        { libelle: "Supprimer l'ordre", action: () => operer((c) => supprimerOrdre(c, o.ticket)) },
      );
    }
    elements.push(
      { separateur: true },
      {
        libelle: 'Opérations groupées',
        desactive: compte.positions.length + compte.ordres.length === 0,
        sousMenu: [
          { libelle: 'Fermer toutes les positions', action: () => operer((c) => ({ compte: c.positions.reduce((a, x) => fermerPosition(a, x.ticket, cotations).compte, c), erreur: null }), { silencieux: true }) },
          { libelle: 'Fermer les positions gagnantes', action: () => operer((c) => ({ compte: c.positions.filter((x) => profitPosition(x, cotations) > 0).reduce((a, x) => fermerPosition(a, x.ticket, cotations).compte, c), erreur: null }), { silencieux: true }) },
          { libelle: 'Fermer les positions perdantes', action: () => operer((c) => ({ compte: c.positions.filter((x) => profitPosition(x, cotations) < 0).reduce((a, x) => fermerPosition(a, x.ticket, cotations).compte, c), erreur: null }), { silencieux: true }) },
          ...(p ? [{ libelle: `Fermer les positions ${p.symbole}`, action: () => operer((c) => ({ compte: c.positions.filter((x) => x.symbole === p.symbole).reduce((a, x) => fermerPosition(a, x.ticket, cotations).compte, c), erreur: null }), { silencieux: true }) }] : []),
          { separateur: true },
          { libelle: 'Supprimer tous les ordres', action: () => operer((c) => ({ compte: c.ordres.reduce((a, x) => supprimerOrdre(a, x.ticket).compte, c), erreur: null }), { silencieux: true }) },
        ],
      },
      { separateur: true },
      { libelle: 'Profit', sousMenu: [
        { libelle: 'En devise du dépôt', coche: !enPoints, action: () => setEnPoints(false) },
        { libelle: 'En points', coche: enPoints, action: () => setEnPoints(true) },
      ] },
    );
    ouvrirMenu(ev.clientX, ev.clientY, elements);
  };

  return (
    <div className="onglet-trading" onContextMenu={(ev) => menuTrading(ev)}>
      <table className="table boite-table">
        <thead>
          <tr>
            <th>Symbole</th>
            <th>Ticket</th>
            <th>Heure</th>
            <th>Type</th>
            <th className="d">Volume</th>
            <th className="d">Prix</th>
            <th className="d">S / L</th>
            <th className="d">T / P</th>
            <th className="d">Prix</th>
            <th className="d">Swap</th>
            <th className="d">Profit</th>
            <th>Commentaire</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {compte.positions.map((p) => {
            const s = symbole(p.symbole)!;
            const q = cotations[p.symbole];
            const profit = profitPosition(p, cotations);
            const pts = q ? Math.round(((p.type === 'buy' ? q.bid - p.prixOuverture : p.prixOuverture - q.ask) / point(s))) : 0;
            return (
              <tr key={p.ticket} className={choisi === p.ticket ? 'choisi' : ''} onClick={() => setChoisi(p.ticket)} onDoubleClick={() => ouvrir({ type: 'modifier-position', ticket: p.ticket })} onContextMenu={(ev) => { ev.stopPropagation(); menuTrading(ev, p.ticket); }}>
                <td>
                  <span className={`puce ${p.type}`} /> {p.symbole}
                </td>
                <td>{p.ticket}</td>
                <td>{dateMT(p.heure)}</td>
                <td className={p.type}>{p.type}</td>
                <td className="d">{p.volume.toFixed(2)}</td>
                <td className="d">{formaterPrix(s, p.prixOuverture)}</td>
                <td className="d stop" onDoubleClick={(ev) => { ev.stopPropagation(); ouvrir({ type: 'modifier-position', ticket: p.ticket }); }}>{p.sl ? formaterPrix(s, p.sl) : ''}{p.suiveur ? ' ↻' : ''}</td>
                <td className="d stop">{p.tp ? formaterPrix(s, p.tp) : ''}</td>
                <td className="d">{q ? formaterPrix(s, prixFermeture(p.type, q)) : '—'}</td>
                <td className="d">{argent(p.swap)}</td>
                <td className={`d gras ${profit >= 0 ? 'positif' : 'negatif'}`}>{enPoints ? pts : argent(profit)}</td>
                <td>{p.commentaire}</td>
                <td>
                  <button className="croix" title="Fermer la position" onClick={(ev) => { ev.stopPropagation(); operer((c) => fermerPosition(c, p.ticket, cotations)); }}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          <tr className="ligne-solde">
            <td colSpan={10}>
              <span className="puce solde" /> Solde : <b>{argent(e.solde)} USD</b>&nbsp;&nbsp; Fonds propres : <b>{argent(e.fondsPropres)}</b>&nbsp;&nbsp; Marge : <b>{argent(e.marge)}</b>&nbsp;&nbsp; Marge libre : <b>{argent(e.margeLibre)}</b>&nbsp;&nbsp; Niveau de marge : <b>{e.niveauMarge === null ? '' : `${argent(e.niveauMarge)} %`}</b>
            </td>
            <td className={`d gras ${e.profit >= 0 ? 'positif' : 'negatif'}`}>{argent(e.profit)}</td>
            <td colSpan={2} />
          </tr>
          {compte.ordres.map((o) => {
            const s = symbole(o.symbole)!;
            const q = cotations[o.symbole];
            const actuel = q ? (o.type.startsWith('buy') ? q.ask : q.bid) : undefined;
            return (
              <tr key={o.ticket} className={`ordre ${choisi === o.ticket ? 'choisi' : ''}`} onClick={() => setChoisi(o.ticket)} onDoubleClick={() => ouvrir({ type: 'modifier-ordre', ticket: o.ticket })} onContextMenu={(ev) => { ev.stopPropagation(); menuTrading(ev, o.ticket); }}>
                <td>
                  <span className="puce ordre" /> {o.symbole}
                </td>
                <td>{o.ticket}</td>
                <td>{dateMT(o.heure)}</td>
                <td>{LIBELLES_TYPE[o.type]}</td>
                <td className="d">{o.volume.toFixed(2)}</td>
                <td className="d">{formaterPrix(s, o.prix)}{o.prixLimite ? ` / ${formaterPrix(s, o.prixLimite)}` : ''}</td>
                <td className="d stop">{o.sl ? formaterPrix(s, o.sl) : ''}</td>
                <td className="d stop">{o.tp ? formaterPrix(s, o.tp) : ''}</td>
                <td className="d">{actuel !== undefined ? formaterPrix(s, actuel) : '—'}</td>
                <td colSpan={2} className="d muet">{o.expiration === 'gtc' ? '' : o.expiration === 'jour' ? 'aujourd\'hui' : dateMT(o.echeance, false)}</td>
                <td>{o.commentaire}</td>
                <td>
                  <button className="croix" title="Supprimer l'ordre" onClick={(ev) => { ev.stopPropagation(); operer((c) => supprimerOrdre(c, o.ticket)); }}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {menu}
    </div>
  );
}

// ---------- Exposition ----------

export function OngletExposition() {
  const { compte, cotations } = useTerminal();
  // Exposition nette par actif : un achat EURUSD = +EUR, −USD (en unités de chaque devise).
  const lignes = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of compte.positions) {
      const s = symbole(p.symbole);
      if (!s) continue;
      const signe = p.type === 'buy' ? 1 : -1;
      const unites = p.volume * s.contrat;
      m.set(s.base, (m.get(s.base) ?? 0) + signe * unites);
      m.set(s.profit, (m.get(s.profit) ?? 0) - signe * unites * p.prixOuverture);
    }
    return [...m.entries()].map(([actif, volume]) => {
      // Taux en USD : devise connue, sinon cotation du symbole dont c'est la base.
      const s = [...compte.positions].map((p) => symbole(p.symbole)!).find((x) => x.base === actif);
      let taux = 1;
      if (actif !== 'USD') {
        const devise = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'].includes(actif);
        if (devise) taux = conversion({ ...symbole('EURUSD')!, profit: actif as 'EUR' }, cotations);
        else if (s) taux = ((cotations[s.nom]?.bid ?? 0) * conversion(s, cotations));
      }
      return { actif, volume, taux, usd: volume * taux };
    });
  }, [compte.positions, cotations]);
  const max = Math.max(1, ...lignes.map((l) => Math.abs(l.usd)));
  if (lignes.length === 0) return <div className="vide-boite">Aucune position ouverte.</div>;
  return (
    <table className="table boite-table">
      <thead>
        <tr>
          <th>Actif</th>
          <th className="d">Volume</th>
          <th className="d">Taux</th>
          <th className="d">USD</th>
          <th>Graphique</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.actif}>
            <td>{l.actif}</td>
            <td className={`d ${l.volume >= 0 ? 'positif' : 'negatif'}`}>{argent(l.volume)}</td>
            <td className="d">{l.taux.toFixed(5)}</td>
            <td className={`d ${l.usd >= 0 ? 'positif' : 'negatif'}`}>{argent(l.usd)}</td>
            <td style={{ width: '40%' }}>
              <div className="barre-expo">
                <div className={l.usd >= 0 ? 'long' : 'court'} style={{ width: `${(Math.abs(l.usd) / max) * 50}%`, [l.usd >= 0 ? 'left' : 'right']: '50%' }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Historique ----------

type ModeHisto = 'positions' | 'transactions' | 'ordres';
type PeriodeHisto = 'jour' | 'semaine' | 'mois' | '3mois' | 'tout';

export function OngletHistorique() {
  const { compte, ouvrir } = useTerminal();
  const [mode, setMode] = useState<ModeHisto>('positions');
  const [periode, setPeriode] = useState<PeriodeHisto>('tout');
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const depuis = useMemo(() => {
    const d = new Date();
    if (periode === 'jour') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (periode === 'semaine') return Date.now() - 7 * 86400000;
    if (periode === 'mois') return Date.now() - 30 * 86400000;
    if (periode === '3mois') return Date.now() - 91 * 86400000;
    return 0;
  }, [periode]);
  const deals = compte.transactions.filter((d) => d.heure >= depuis);
  const sorties = deals.filter((d) => d.entree === 'out');
  const profit = sorties.reduce((s, d) => s + d.profit, 0);
  const swaps = sorties.reduce((s, d) => s + d.swap, 0);
  const commissions = deals.reduce((s, d) => s + d.commission, 0);
  const depots = deals.filter((d) => d.type === 'balance' && d.profit > 0).reduce((s, d) => s + d.profit, 0);
  const retraits = deals.filter((d) => d.type === 'balance' && d.profit < 0).reduce((s, d) => s + d.profit, 0);
  const gagnants = sorties.filter((d) => d.profit > 0).length;

  const exporter = () => {
    const entetes = ['Heure', 'Transaction', 'Symbole', 'Type', 'Direction', 'Volume', 'Prix', 'Ordre', 'Commission', 'Swap', 'Profit', 'Solde', 'Commentaire'];
    const lignes = deals.map((d) => [dateMT(d.heure), d.ticket, d.symbole, d.type, d.entree, d.volume || '', d.prix || '', d.ordre || '', d.commission, d.swap, d.profit, d.solde, d.commentaire]);
    const csv = [entetes, ...lignes].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ReportHistory-${compte.login}.csv`;
    a.click();
  };

  const menuHisto = (ev: React.MouseEvent) => {
    ev.preventDefault();
    ouvrirMenu(ev.clientX, ev.clientY, [
      { libelle: 'Positions', coche: mode === 'positions', action: () => setMode('positions') },
      { libelle: 'Transactions', coche: mode === 'transactions', action: () => setMode('transactions') },
      { libelle: 'Ordres', coche: mode === 'ordres', action: () => setMode('ordres') },
      { separateur: true },
      { libelle: "Aujourd'hui", coche: periode === 'jour', action: () => setPeriode('jour') },
      { libelle: 'Semaine dernière', coche: periode === 'semaine', action: () => setPeriode('semaine') },
      { libelle: 'Mois dernier', coche: periode === 'mois', action: () => setPeriode('mois') },
      { libelle: '3 derniers mois', coche: periode === '3mois', action: () => setPeriode('3mois') },
      { libelle: 'Tout l\'historique', coche: periode === 'tout', action: () => setPeriode('tout') },
      { separateur: true },
      { libelle: 'Rapport…', action: () => ouvrir({ type: 'rapport' }) },
      { libelle: 'Enregistrer comme rapport (HTML)', action: () => void enregistrerRapport(`ReportHistory-${compte.login}.html`, rapportHtml(enteteCompte(compte), compte.transactions)) },
      { libelle: 'Exporter (CSV)', action: exporter },
    ]);
  };

  return (
    <div className="onglet-historique" onContextMenu={menuHisto}>
      <div className="histo-barre">
        {(['positions', 'transactions', 'ordres'] as ModeHisto[]).map((m) => (
          <button key={m} className={mode === m ? 'actif' : ''} onClick={() => setMode(m)}>
            {m === 'positions' ? 'Positions' : m === 'transactions' ? 'Transactions' : 'Ordres'}
          </button>
        ))}
        <select value={periode} onChange={(e) => setPeriode(e.target.value as PeriodeHisto)}>
          <option value="jour">Aujourd'hui</option>
          <option value="semaine">Semaine dernière</option>
          <option value="mois">Mois dernier</option>
          <option value="3mois">3 derniers mois</option>
          <option value="tout">Tout l'historique</option>
        </select>
        <button onClick={() => ouvrir({ type: 'rapport' })}>Rapport</button>
        <button onClick={exporter}>Export CSV</button>
      </div>
      <table className="table boite-table">
        {mode === 'positions' && (
          <>
            <thead>
              <tr>
                <th>Heure</th>
                <th>Position</th>
                <th>Symbole</th>
                <th>Type</th>
                <th className="d">Volume</th>
                <th className="d">Prix</th>
                <th className="d">S / L</th>
                <th className="d">T / P</th>
                <th>Heure</th>
                <th className="d">Prix</th>
                <th className="d">Commission</th>
                <th className="d">Swap</th>
                <th className="d">Profit</th>
              </tr>
            </thead>
            <tbody>
              {sorties
                .slice()
                .reverse()
                .map((d) => {
                  const s = symbole(d.symbole);
                  const type = d.type === 'sell' ? 'buy' : 'sell';
                  return (
                    <tr key={d.ticket}>
                      <td>{dateMT(d.heureOuverture ?? d.heure)}</td>
                      <td>{d.position}</td>
                      <td>{d.symbole}</td>
                      <td className={type}>{type}</td>
                      <td className="d">{d.volume.toFixed(2)}</td>
                      <td className="d">{d.prixOuverture !== undefined ? formaterPrix(s, d.prixOuverture) : ''}</td>
                      <td className="d">{d.sl ? formaterPrix(s, d.sl) : ''}</td>
                      <td className="d">{d.tp ? formaterPrix(s, d.tp) : ''}</td>
                      <td>{dateMT(d.heure)}</td>
                      <td className="d">{formaterPrix(s, d.prix)}</td>
                      <td className="d">{argent(d.commission)}</td>
                      <td className="d">{argent(d.swap)}</td>
                      <td className={`d gras ${d.profit >= 0 ? 'positif' : 'negatif'}`}>{argent(d.profit)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </>
        )}
        {mode === 'transactions' && (
          <>
            <thead>
              <tr>
                <th>Heure</th>
                <th>Transaction</th>
                <th>Symbole</th>
                <th>Type</th>
                <th>Direction</th>
                <th className="d">Volume</th>
                <th className="d">Prix</th>
                <th>Ordre</th>
                <th className="d">Commission</th>
                <th className="d">Swap</th>
                <th className="d">Profit</th>
                <th className="d">Solde</th>
                <th>Commentaire</th>
              </tr>
            </thead>
            <tbody>
              {deals
                .slice()
                .reverse()
                .map((d: Transaction) => {
                  const s = symbole(d.symbole);
                  return (
                    <tr key={d.ticket}>
                      <td>{dateMT(d.heure)}</td>
                      <td>{d.ticket}</td>
                      <td>{d.symbole}</td>
                      <td className={d.type}>{d.type}</td>
                      <td>{d.entree}</td>
                      <td className="d">{d.volume ? d.volume.toFixed(2) : ''}</td>
                      <td className="d">{d.prix ? formaterPrix(s, d.prix) : ''}</td>
                      <td>{d.ordre || ''}</td>
                      <td className="d">{argent(d.commission)}</td>
                      <td className="d">{argent(d.swap)}</td>
                      <td className={`d ${d.profit > 0 ? 'positif' : d.profit < 0 ? 'negatif' : ''}`}>{argent(d.profit)}</td>
                      <td className="d">{argent(d.solde)}</td>
                      <td>{d.commentaire}</td>
                    </tr>
                  );
                })}
            </tbody>
          </>
        )}
        {mode === 'ordres' && (
          <>
            <thead>
              <tr>
                <th>Heure d'ouverture</th>
                <th>Ordre</th>
                <th>Symbole</th>
                <th>Type</th>
                <th className="d">Volume</th>
                <th className="d">Prix</th>
                <th className="d">S / L</th>
                <th className="d">T / P</th>
                <th>Heure</th>
                <th>État</th>
                <th>Commentaire</th>
              </tr>
            </thead>
            <tbody>
              {compte.ordresHisto
                .filter((o) => o.heureFin >= depuis)
                .slice()
                .reverse()
                .map((o) => {
                  const s = symbole(o.symbole);
                  return (
                    <tr key={`${o.ticket}-${o.heureFin}`}>
                      <td>{dateMT(o.heure)}</td>
                      <td>{o.ticket}</td>
                      <td>{o.symbole}</td>
                      <td>{LIBELLES_TYPE[o.type]}</td>
                      <td className="d">{o.volume.toFixed(2)}</td>
                      <td className="d">{formaterPrix(s, o.prix)}</td>
                      <td className="d">{o.sl ? formaterPrix(s, o.sl) : ''}</td>
                      <td className="d">{o.tp ? formaterPrix(s, o.tp) : ''}</td>
                      <td>{dateMT(o.heureFin)}</td>
                      <td>{o.etat}</td>
                      <td>{o.commentaire}</td>
                    </tr>
                  );
                })}
            </tbody>
          </>
        )}
        <tbody>
          <tr className="ligne-solde">
            <td colSpan={13}>
              Profit : <b className={profit >= 0 ? 'positif' : 'negatif'}>{argent(profit)}</b>&nbsp;&nbsp; Crédit : <b>0.00</b>&nbsp;&nbsp; Dépôt : <b>{argent(depots)}</b>&nbsp;&nbsp; Retrait : <b>{argent(retraits)}</b>&nbsp;&nbsp; Swap : <b>{argent(swaps)}</b>&nbsp;&nbsp; Commission : <b>{argent(commissions)}</b>&nbsp;&nbsp; Solde : <b>{argent(compte.solde)}</b>&nbsp;&nbsp; Trades : <b>{sorties.length}</b> ({sorties.length ? Math.round((gagnants / sorties.length) * 100) : 0} % gagnants)
            </td>
          </tr>
        </tbody>
      </table>
      {menu}
    </div>
  );
}

// ---------- Actualités et calendrier (relais Parnassa) ----------

interface Depeche {
  id: string;
  titre: string;
  titreFr?: string;
  lien: string;
  source: string;
  date: number;
  important: boolean;
}

export function OngletActualites() {
  const [depeches, setDepeches] = useState<Depeche[] | null>(null);
  const [choisie, setChoisie] = useState<Depeche | null>(null);
  useEffect(() => {
    let actif = true;
    const charger = () =>
      fetch(`${RELAIS}/flux`)
        .then((r) => r.json() as Promise<{ depeches: Depeche[] }>)
        .then((d) => actif && setDepeches(d.depeches.slice(0, 200)))
        .catch(() => actif && setDepeches([]));
    void charger();
    const t = window.setInterval(charger, 60000);
    return () => {
      actif = false;
      window.clearInterval(t);
    };
  }, []);
  if (!depeches) return <div className="vide-boite">Chargement des actualités…</div>;
  return (
    <div className="actualites">
      <table className="table boite-table">
        <thead>
          <tr>
            <th style={{ width: 130 }}>Heure</th>
            <th>Titre</th>
            <th style={{ width: 140 }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {depeches.map((d) => (
            <tr key={d.id} className={`${d.important ? 'important' : ''} ${choisie?.id === d.id ? 'choisi' : ''}`} onClick={() => setChoisie(d)} onDoubleClick={() => window.open(d.lien, '_blank', 'noopener')}>
              <td>{dateMT(d.date, false)}</td>
              <td>{d.titreFr ?? d.titre}</td>
              <td>{d.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Evenement {
  id: string;
  titre: string;
  titreFr?: string;
  pays: string;
  devise: string;
  date: number;
  importance: number;
  actuel: number | null;
  prevision: number | null;
  precedent: number | null;
  unite: string;
  echelle: string;
}

export function OngletCalendrier() {
  const [evenements, setEvenements] = useState<Evenement[] | null>(null);
  const [importance, setImportance] = useState(0);
  useEffect(() => {
    fetch(`${RELAIS}/calendrier`)
      .then((r) => r.json() as Promise<{ evenements: Evenement[] }>)
      .then((d) => setEvenements(d.evenements))
      .catch(() => setEvenements([]));
  }, []);
  if (!evenements) return <div className="vide-boite">Chargement du calendrier…</div>;
  const v = (x: number | null, e: Evenement) => (x === null ? '' : `${x}${e.echelle}${e.unite}`);
  const liste = evenements.filter((e) => e.importance >= importance);
  return (
    <div className="calendrier">
      <div className="histo-barre">
        <span>Importance :</span>
        {[
          [-1, 'Toutes'],
          [0, 'Moyenne et haute'],
          [1, 'Haute'],
        ].map(([n, l]) => (
          <button key={n} className={importance === n ? 'actif' : ''} onClick={() => setImportance(Number(n))}>
            {l}
          </button>
        ))}
      </div>
      <table className="table boite-table">
        <thead>
          <tr>
            <th>Heure</th>
            <th>Devise</th>
            <th>Importance</th>
            <th>Événement</th>
            <th className="d">Actuel</th>
            <th className="d">Prévision</th>
            <th className="d">Précédent</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((e) => (
            <tr key={e.id} className={e.date < Date.now() ? 'passe' : ''}>
              <td>{dateMT(e.date, false)}</td>
              <td>{e.devise}</td>
              <td>
                <span className={`importance i${e.importance}`}>{e.importance >= 1 ? 'Haute' : e.importance === 0 ? 'Moyenne' : 'Faible'}</span>
              </td>
              <td>{e.titreFr ?? e.titre}</td>
              <td className={`d gras ${e.actuel !== null && e.prevision !== null ? (e.actuel >= e.prevision ? 'positif' : 'negatif') : ''}`}>{v(e.actuel, e)}</td>
              <td className="d">{v(e.prevision, e)}</td>
              <td className="d">{v(e.precedent, e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Boîte aux lettres ----------

export const MESSAGES = [
  {
    id: 'bienvenue',
    de: 'Parnassa Trader',
    date: Date.UTC(2026, 9, 7, 8, 0),
    titre: 'Bienvenue sur Parnassa Trader',
    texte:
      "Bienvenue ! Votre compte de démonstration est ouvert sur le serveur Parnassa-Demo avec 10 000 USD et un levier de 1:100.\n\n" +
      "• Ouvrez une position avec F9 (Nouvel ordre) ou directement depuis le panneau de trading en un clic du graphique.\n" +
      "• Faites glisser les lignes SL, TP et des ordres en attente sur le graphique pour les modifier.\n" +
      "• Clic droit sur le graphique → Trading pour placer un ordre limite ou stop au prix pointé.\n" +
      "• Les cotations sont réelles (forex, or, indices, actions, crypto) ; l'argent ne l'est pas.\n\n" +
      'Bon trading !',
  },
  {
    id: 'regles',
    de: 'Parnassa Trader',
    date: Date.UTC(2026, 9, 7, 8, 1),
    titre: 'Conditions de trading du compte démo',
    texte:
      "Mode de compte : couverture (hedging). Achat à l'Ask, vente au Bid.\n" +
      'Appel de marge : 100 %. Stop-out : 50 % (la position la plus perdante est fermée en premier).\n' +
      'Forex : écarts fixes de 1,2 à 3 pips selon la paire. Crypto : carnet d\'ordres réel de Binance.\n' +
      'Séances : forex, métaux, indices et énergie du dimanche 22:00 au vendredi 21:00 UTC ; actions selon leur bourse ; crypto 24 h/24.',
  },
];

export function OngletCourrier() {
  const { etat, maj } = useTerminal();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const m = MESSAGES.find((x) => x.id === ouvert);
  return (
    <div className="courrier">
      <table className="table boite-table">
        <thead>
          <tr>
            <th style={{ width: 130 }}>Heure</th>
            <th style={{ width: 150 }}>De</th>
            <th>Titre</th>
          </tr>
        </thead>
        <tbody>
          {MESSAGES.map((x) => (
            <tr
              key={x.id}
              className={`${etat.lus.includes(x.id) ? '' : 'gras'} ${ouvert === x.id ? 'choisi' : ''}`}
              onClick={() => {
                setOuvert(x.id);
                if (!etat.lus.includes(x.id)) maj((e) => ({ ...e, lus: [...e.lus, x.id] }));
              }}
            >
              <td>{dateMT(x.date, false)}</td>
              <td>{x.de}</td>
              <td>{x.titre}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m && <div className="courrier-texte">{m.texte}</div>}
    </div>
  );
}

// ---------- Alertes ----------

export function OngletAlertes() {
  const { etat, maj, ouvrir, cotations } = useTerminal();
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  return (
    <div
      className="alertes"
      onContextMenu={(ev) => {
        ev.preventDefault();
        ouvrirMenu(ev.clientX, ev.clientY, [{ libelle: 'Créer…', raccourci: 'Inser', action: () => ouvrir({ type: 'alerte' }) }]);
      }}
    >
      <table className="table boite-table">
        <thead>
          <tr>
            <th>Symbole</th>
            <th>Condition</th>
            <th className="d">Valeur</th>
            <th className="d">Actuel</th>
            <th>Déclenchée</th>
            <th>Commentaire</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {etat.alertes.map((a) => {
            const s = symbole(a.symbole);
            const c = cotations[a.symbole];
            return (
              <tr
                key={a.id}
                className={a.active ? '' : 'muet'}
                onDoubleClick={() => ouvrir({ type: 'alerte', id: a.id })}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  ouvrirMenu(ev.clientX, ev.clientY, [
                    { libelle: 'Créer…', action: () => ouvrir({ type: 'alerte' }) },
                    { libelle: 'Modifier…', action: () => ouvrir({ type: 'alerte', id: a.id }) },
                    { libelle: a.active ? 'Désactiver' : 'Activer', action: () => maj((e) => ({ ...e, alertes: e.alertes.map((x) => (x.id === a.id ? { ...x, active: !x.active, declencheeLe: undefined } : x)) })) },
                    { libelle: 'Supprimer', action: () => maj((e) => ({ ...e, alertes: e.alertes.filter((x) => x.id !== a.id) })) },
                  ]);
                }}
              >
                <td>{a.symbole}</td>
                <td>{CONDITIONS[a.condition]}</td>
                <td className="d">{a.condition === 'heure=' ? dateMT(a.valeur).slice(0, 16) : formaterPrix(s, a.valeur)}</td>
                <td className="d">{a.condition === 'heure=' ? '' : c ? formaterPrix(s, a.condition.startsWith('bid') ? c.bid : c.ask) : ''}</td>
                <td>
                  {a.declencheeLe ? dateMT(a.declencheeLe) : ''}
                  {(a.max ?? 1) > 1 ? ` (${a.declenchements ?? 0}/${a.max})` : ''}
                  {a.expiration && a.active ? ` · expire ${dateMT(a.expiration).slice(0, 16)}` : ''}
                </td>
                <td>{a.commentaire}</td>
                <td>
                  <button className="croix" onClick={() => maj((e) => ({ ...e, alertes: e.alertes.filter((x) => x.id !== a.id) }))}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {etat.alertes.length === 0 && (
        <div className="vide-boite">
          Aucune alerte. <button onClick={() => ouvrir({ type: 'alerte' })}>Créer une alerte</button>
        </div>
      )}
      {menu}
    </div>
  );
}

// ---------- Journal ----------

export function OngletJournal() {
  const { compte } = useTerminal();
  const [filtre, setFiltre] = useState('');
  const lignes = compte.journal.filter((j) => !filtre || j.message.toLowerCase().includes(filtre.toLowerCase())).slice(-500).reverse();
  return (
    <div className="journal">
      <div className="histo-barre">
        <input placeholder="Rechercher dans le journal" value={filtre} onChange={(e) => setFiltre(e.target.value)} />
      </div>
      <table className="table boite-table">
        <thead>
          <tr>
            <th style={{ width: 150 }}>Heure</th>
            <th style={{ width: 80 }}>Source</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((j, i) => (
            <tr key={i} className={/échec/.test(j.message) ? 'erreur' : ''}>
              <td>{dateMT(j.heure)}</td>
              <td>{j.source}</td>
              <td>{j.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
