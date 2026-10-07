import { useState } from 'react';
import { useTerminal } from '../contexte';
import { formaterPrix, point, symbole } from '../marche/symboles';
import { PERIODES } from '../marche/bougies';
import { etatCompte, fermerPosition, LIBELLES_TYPE, profitPosition, prixFermeture, supprimerOrdre } from '../compte/moteur';
import { FenetreGraphique } from '../graphique/FenetreGraphique';
import { OngletActualites, OngletAlertes, OngletCalendrier, OngletCourrier, OngletJournal, MESSAGES } from '../composants/BoiteOutils';
import { PrixGros, argent, dateMT, heureMT } from '../composants/ui';

type Onglet = 'cotations' | 'graphique' | 'trade' | 'historique' | 'plus';
type Plus = null | 'actualites' | 'calendrier' | 'courrier' | 'alertes' | 'journal' | 'comptes' | 'reglages';

/** Interface téléphone, organisée comme l'application mobile MT5. */
export function Mobile() {
  const t = useTerminal();
  const { etat, maj } = t;
  const [onglet, setOnglet] = useState<Onglet>('cotations');
  const [plus, setPlus] = useState<Plus>(null);
  const graphique = etat.graphiques.find((g) => g.id === etat.graphiqueActif) ?? etat.graphiques[0];
  const voirGraphique = (sym: string) => {
    if (graphique) t.majGraphique(graphique.id, { symbole: sym });
    else t.ouvrirGraphique(sym);
    setOnglet('graphique');
  };
  const nonLus = MESSAGES.filter((m) => !etat.lus.includes(m.id)).length;
  const ONGLETS: [Onglet, string, string][] = [
    ['cotations', 'Cotations', '⇅'],
    ['graphique', 'Graphique', '📈'],
    ['trade', 'Trade', '◔'],
    ['historique', 'Historique', '⟲'],
    ['plus', 'Plus', '☰'],
  ];
  return (
    <div className="mobile">
      <div className="m-contenu">
        {onglet === 'cotations' && <Cotations voirGraphique={voirGraphique} />}
        {onglet === 'graphique' && graphique && (
          <div className="m-graphique">
            <div className="m-entete">
              <select value={graphique.symbole} onChange={(e) => t.majGraphique(graphique.id, { symbole: e.target.value })}>
                {etat.observation.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <button className="m-action" onClick={() => t.ouvrir({ type: 'ordre', symbole: graphique.symbole })}>
                + Ordre
              </button>
            </div>
            <div className="m-periodes">
              {PERIODES.map((p) => (
                <button key={p.id} className={graphique.periode === p.id ? 'actif' : ''} onClick={() => t.majGraphique(graphique.id, { periode: p.id })}>
                  {p.id}
                </button>
              ))}
              <button onClick={() => t.ouvrir({ type: 'liste-indicateurs', graphique: graphique.id })}>ƒ</button>
            </div>
            <div className="m-graphique-zone">
              <FenetreGraphique g={graphique} actif activer={() => undefined} />
            </div>
          </div>
        )}
        {onglet === 'trade' && <Trade />}
        {onglet === 'historique' && <Historique />}
        {onglet === 'plus' && (
          <div className="m-plus">
            {plus === null ? (
              <>
                <div className="m-entete">
                  <h1>Plus</h1>
                </div>
                <ul className="m-liste-menu">
                  <li onClick={() => setPlus('comptes')}>👤 Comptes</li>
                  <li onClick={() => setPlus('courrier')}>✉️ Boîte aux lettres {nonLus > 0 && <span className="pastille">{nonLus}</span>}</li>
                  <li onClick={() => setPlus('actualites')}>📰 Actualités</li>
                  <li onClick={() => setPlus('calendrier')}>📅 Calendrier économique</li>
                  <li onClick={() => setPlus('alertes')}>🔔 Alertes</li>
                  <li onClick={() => setPlus('journal')}>📜 Journal</li>
                  <li onClick={() => setPlus('reglages')}>⚙️ Paramètres</li>
                  <li onClick={() => t.ouvrir({ type: 'apropos' })}>ℹ️ À propos</li>
                </ul>
              </>
            ) : (
              <>
                <div className="m-entete">
                  <button className="m-retour" onClick={() => setPlus(null)}>
                    ‹ Plus
                  </button>
                </div>
                <div className="m-plus-corps">
                  {plus === 'actualites' && <OngletActualites />}
                  {plus === 'calendrier' && <OngletCalendrier />}
                  {plus === 'courrier' && <OngletCourrier />}
                  {plus === 'alertes' && <OngletAlertes />}
                  {plus === 'journal' && <OngletJournal />}
                  {plus === 'comptes' && <Comptes />}
                  {plus === 'reglages' && (
                    <ul className="m-liste-menu">
                      <li onClick={() => maj((e) => ({ ...e, theme: e.theme === 'sombre' ? 'clair' : 'sombre' }))}>Thème : {etat.theme === 'sombre' ? 'sombre' : 'clair'}</li>
                      <li onClick={() => maj((e) => ({ ...e, son: !e.son }))}>Sons : {etat.son ? 'activés' : 'désactivés'}</li>
                      <li onClick={() => (etat.unClicAccepte ? maj((e) => ({ ...e, unClicAccepte: false })) : t.ouvrir({ type: 'unclic' }))}>Trading en un clic : {etat.unClicAccepte ? 'activé' : 'désactivé'}</li>
                      <li onClick={() => t.ouvrir({ type: 'symboles' })}>Symboles affichés…</li>
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <nav className="m-onglets">
        {ONGLETS.map(([id, l, i]) => (
          <button key={id} className={onglet === id ? 'actif' : ''} onClick={() => setOnglet(id)}>
            <span className="m-icone">{i}</span>
            {l}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Cotations({ voirGraphique }: { voirGraphique: (s: string) => void }) {
  const { etat, cotations, ouvrir } = useTerminal();
  const [choisi, setChoisi] = useState<string | null>(null);
  return (
    <div className="m-cotations">
      <div className="m-entete">
        <h1>Cotations</h1>
        <button className="m-action" onClick={() => ouvrir({ type: 'symboles' })}>
          +
        </button>
      </div>
      <ul>
        {etat.observation.map((nom) => {
          const s = symbole(nom)!;
          const c = cotations[nom];
          const variation = c ? ((c.bid - c.ouverture) / c.ouverture) * 100 : 0;
          const couleur = c?.sens === -1 ? 'baisse' : 'hausse';
          return (
            <li key={nom} onClick={() => setChoisi(choisi === nom ? null : nom)}>
              <div className="m-cot">
                <div className="m-cot-nom">
                  <span className={variation >= 0 ? 'positif' : 'negatif'}>{c ? `${variation >= 0 ? '+' : ''}${variation.toFixed(2)}%` : ''}</span>
                  <b>{nom}</b>
                  <small>
                    {c ? heureMT(c.heure) : '—'} · {c ? Math.round((c.ask - c.bid) / point(s)) : '—'}
                  </small>
                </div>
                <div className={`m-cot-prix ${couleur}`}>
                  <PrixGros s={s} prix={c?.bid} />
                  <small>L : {c ? formaterPrix(s, c.bas) : '—'}</small>
                </div>
                <div className={`m-cot-prix ${couleur}`}>
                  <PrixGros s={s} prix={c?.ask} />
                  <small>H : {c ? formaterPrix(s, c.haut) : '—'}</small>
                </div>
              </div>
              {choisi === nom && (
                <div className="m-cot-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => ouvrir({ type: 'ordre', symbole: nom })}>Nouvel ordre</button>
                  <button onClick={() => voirGraphique(nom)}>Graphique</button>
                  <button onClick={() => ouvrir({ type: 'specification', symbole: nom })}>Propriétés</button>
                  {s.direct.binance && <button onClick={() => ouvrir({ type: 'profondeur', symbole: nom })}>Profondeur</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Trade() {
  const { compte, cotations, operer, ouvrir } = useTerminal();
  const e = etatCompte(compte, cotations);
  const [ouvert, setOuvert] = useState<number | null>(null);
  return (
    <div className="m-trade">
      <div className="m-entete">
        <h1 className={e.profit >= 0 ? 'positif' : 'negatif'}>
          {e.profit >= 0 ? '' : ''}
          {argent(e.profit)} USD
        </h1>
        <button className="m-action" onClick={() => ouvrir({ type: 'ordre' })}>
          +
        </button>
      </div>
      <dl className="m-resume">
        <dt>Solde :</dt>
        <dd>{argent(e.solde)}</dd>
        <dt>Fonds propres :</dt>
        <dd>{argent(e.fondsPropres)}</dd>
        <dt>Marge :</dt>
        <dd>{argent(e.marge)}</dd>
        <dt>Marge libre :</dt>
        <dd>{argent(e.margeLibre)}</dd>
        <dt>Niveau de marge (%) :</dt>
        <dd>{e.niveauMarge === null ? '—' : argent(e.niveauMarge)}</dd>
      </dl>
      <h2 className="m-section">Positions</h2>
      <ul className="m-positions">
        {compte.positions.map((p) => {
          const s = symbole(p.symbole)!;
          const q = cotations[p.symbole];
          const profit = profitPosition(p, cotations);
          return (
            <li key={p.ticket} onClick={() => setOuvert(ouvert === p.ticket ? null : p.ticket)}>
              <div className="m-pos">
                <div>
                  <span>
                    <b>{p.symbole}</b>, <span className={p.type}>{p.type} {p.volume.toFixed(2)}</span>
                  </span>
                  <small>
                    {formaterPrix(s, p.prixOuverture)} → {q ? formaterPrix(s, prixFermeture(p.type, q)) : '—'}
                  </small>
                </div>
                <b className={profit >= 0 ? 'positif' : 'negatif'}>{argent(profit)}</b>
              </div>
              {ouvert === p.ticket && (
                <div className="m-pos-detail" onClick={(ev) => ev.stopPropagation()}>
                  <span>{dateMT(p.heure)}</span>
                  <span>#{p.ticket}</span>
                  <span>S/L : {p.sl ? formaterPrix(s, p.sl) : '—'}</span>
                  <span>T/P : {p.tp ? formaterPrix(s, p.tp) : '—'}</span>
                  <div className="m-cot-actions">
                    <button className="vente" onClick={() => operer((c) => fermerPosition(c, p.ticket, cotations), { confirmation: false })}>
                      Fermer
                    </button>
                    <button onClick={() => ouvrir({ type: 'modifier-position', ticket: p.ticket })}>Modifier</button>
                    <button onClick={() => ouvrir({ type: 'ordre', symbole: p.symbole })}>Nouvel ordre</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {compte.positions.length === 0 && <li className="m-vide">Aucune position</li>}
      </ul>
      {compte.ordres.length > 0 && (
        <>
          <h2 className="m-section">Ordres</h2>
          <ul className="m-positions">
            {compte.ordres.map((o) => {
              const s = symbole(o.symbole)!;
              const q = cotations[o.symbole];
              return (
                <li key={o.ticket} onClick={() => setOuvert(ouvert === o.ticket ? null : o.ticket)}>
                  <div className="m-pos">
                    <div>
                      <span>
                        <b>{o.symbole}</b>, {LIBELLES_TYPE[o.type]} {o.volume.toFixed(2)}
                      </span>
                      <small>à {formaterPrix(s, o.prix)}</small>
                    </div>
                    <span>{q ? formaterPrix(s, o.type.startsWith('buy') ? q.ask : q.bid) : ''}</span>
                  </div>
                  {ouvert === o.ticket && (
                    <div className="m-cot-actions" onClick={(ev) => ev.stopPropagation()}>
                      <button className="vente" onClick={() => operer((c) => supprimerOrdre(c, o.ticket), { confirmation: false })}>
                        Supprimer
                      </button>
                      <button onClick={() => ouvrir({ type: 'modifier-ordre', ticket: o.ticket })}>Modifier</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Historique() {
  const { compte } = useTerminal();
  const sorties = compte.transactions.filter((d) => d.entree === 'out');
  const profit = sorties.reduce((s, d) => s + d.profit, 0);
  const depots = compte.transactions.filter((d) => d.type === 'balance').reduce((s, d) => s + d.profit, 0);
  return (
    <div className="m-historique">
      <div className="m-entete">
        <h1>Historique</h1>
      </div>
      <dl className="m-resume">
        <dt>Profit :</dt>
        <dd className={profit >= 0 ? 'positif' : 'negatif'}>{argent(profit)}</dd>
        <dt>Dépôts :</dt>
        <dd>{argent(depots)}</dd>
        <dt>Solde :</dt>
        <dd>{argent(compte.solde)}</dd>
      </dl>
      <ul className="m-positions">
        {sorties
          .slice()
          .reverse()
          .map((d) => {
            const s = symbole(d.symbole);
            const type = d.type === 'sell' ? 'buy' : 'sell';
            return (
              <li key={d.ticket}>
                <div className="m-pos">
                  <div>
                    <span>
                      <b>{d.symbole}</b>, <span className={type}>{type} {d.volume.toFixed(2)}</span>
                    </span>
                    <small>
                      {d.prixOuverture !== undefined ? formaterPrix(s, d.prixOuverture) : ''} → {formaterPrix(s, d.prix)}
                    </small>
                  </div>
                  <div className="d">
                    <b className={d.profit >= 0 ? 'positif' : 'negatif'}>{argent(d.profit)}</b>
                    <small>{dateMT(d.heure)}</small>
                  </div>
                </div>
              </li>
            );
          })}
        {sorties.length === 0 && <li className="m-vide">Aucune transaction clôturée</li>}
      </ul>
    </div>
  );
}

function Comptes() {
  const { etat, maj, ouvrir } = useTerminal();
  return (
    <div className="m-comptes">
      <ul className="m-liste-menu">
        {etat.comptes.map((c) => (
          <li key={c.login} className={c.login === etat.actif ? 'actif' : ''} onClick={() => maj((e) => ({ ...e, actif: c.login }))}>
            <b>{c.nom}</b>
            <small>
              {c.login} — {c.serveur} · 1:{c.levier} · {argent(c.solde)} USD
            </small>
          </li>
        ))}
        <li onClick={() => ouvrir({ type: 'compte' })}>+ Ouvrir un compte de démonstration</li>
        <li onClick={() => ouvrir({ type: 'depot' })}>Dépôt / retrait</li>
      </ul>
    </div>
  );
}
