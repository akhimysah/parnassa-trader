import { useMemo, useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { formaterPrix, symbole } from '../marche/symboles';
import { LIBELLES_TYPE, definirSuiveur, etatCompte, fermerPosition, prixFermeture, profitPosition, supprimerOrdre, type Position } from '../compte/moteur';
import { argent, dateMT } from '../composants/ui';
import { CourbeSolde } from '../composants/Courbe';
import { calculerStats } from '../algo/statistiques';
import { BoutonIcone, EnTete, IconePlus, Segments, useNav, vibrer } from './commun';

type Tri = 'heure' | 'symbole' | 'profit' | 'ticket';

/** Onglet Trade : profit flottant, état du compte, positions et ordres en attente. */
export function Trade({ voirGraphique }: { voirGraphique: (s: string) => void }) {
  const { compte, cotations, etat, operer } = useTerminal();
  const { pousser, feuille } = useNav();
  const [tri, setTri] = useState<Tri>('heure');
  const fermerTout = (filtre: (p: Position) => boolean, libelle: string) => {
    const cibles = compte.positions.filter(filtre);
    if (cibles.length === 0) return;
    if (!window.confirm(`${libelle} : ${cibles.length} position${cibles.length > 1 ? 's' : ''} ?`)) return;
    operer((c) => ({ compte: cibles.reduce((acc, p) => fermerPosition(acc, p.ticket, cotations).compte, c), erreur: null, message: `${cibles.length} position${cibles.length > 1 ? 's' : ''} fermée${cibles.length > 1 ? 's' : ''}` }), { confirmation: false });
    vibrer(25);
  };
  const e = etatCompte(compte, cotations);
  const positions = useMemo(() => {
    const l = [...compte.positions];
    if (tri === 'symbole') l.sort((a, b) => a.symbole.localeCompare(b.symbole));
    else if (tri === 'profit') l.sort((a, b) => profitPosition(b, cotations) - profitPosition(a, cotations));
    else if (tri === 'ticket') l.sort((a, b) => a.ticket - b.ticket);
    else l.sort((a, b) => b.heure - a.heure);
    return l;
  }, [compte.positions, tri, cotations]);
  const symboleDefaut = etat.graphiques.find((g) => g.id === etat.graphiqueActif)?.symbole ?? etat.observation[0] ?? 'EURUSD';
  return (
    <div className="mm-ecran">
      <EnTete
        titre={<span className={e.profit >= 0 ? 'positif' : 'negatif'}>{`${e.profit >= 0 ? '' : '−'}${argent(Math.abs(e.profit))} USD`}</span>}
        gauche={
          <BoutonIcone
            titre="Trier et opérations groupées"
            onClick={() =>
              feuille('Trier par', [
                { libelle: `Heure d'ouverture${tri === 'heure' ? ' ✓' : ''}`, action: () => setTri('heure') },
                { libelle: `Symbole${tri === 'symbole' ? ' ✓' : ''}`, action: () => setTri('symbole') },
                { libelle: `Profit${tri === 'profit' ? ' ✓' : ''}`, action: () => setTri('profit') },
                { libelle: `Ticket${tri === 'ticket' ? ' ✓' : ''}`, action: () => setTri('ticket') },
                ...(compte.positions.length
                  ? [
                      { libelle: 'Fermer toutes les positions', danger: true, action: () => fermerTout(() => true, 'Fermer toutes les positions') },
                      { libelle: 'Fermer les positions gagnantes', danger: true, action: () => fermerTout((p) => profitPosition(p, cotations) > 0, 'Fermer les positions gagnantes') },
                      { libelle: 'Fermer les positions perdantes', danger: true, action: () => fermerTout((p) => profitPosition(p, cotations) < 0, 'Fermer les positions perdantes') },
                    ]
                  : []),
                ...(compte.ordres.length
                  ? [{ libelle: 'Supprimer tous les ordres', danger: true, action: () => operer((c) => ({ compte: c.ordres.reduce((a, o) => supprimerOrdre(a, o.ticket).compte, c), erreur: null, message: 'Ordres supprimés' }), { confirmation: false }) }]
                  : []),
              ])
            }
          >
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M6 3v14M3 14l3 3 3-3M14 17V3M11 6l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BoutonIcone>
        }
        droite={
          <BoutonIcone titre="Nouvel ordre" onClick={() => pousser({ type: 'ordre', symbole: symboleDefaut })}>
            <IconePlus />
          </BoutonIcone>
        }
      />
      <div className="mm-defile">
        {e.niveauMarge !== null && e.niveauMarge < 100 && (
          <div className="mm-bandeau danger">
            <b>Appel de marge</b> — niveau {argent(e.niveauMarge)} %. Sous 50 %, les positions les plus perdantes sont fermées (stop-out).
          </div>
        )}
        <dl className="mm-resume">
          <div>
            <dt>Solde :</dt>
            <dd>{argent(e.solde)}</dd>
          </div>
          <div>
            <dt>Fonds propres :</dt>
            <dd>{argent(e.fondsPropres)}</dd>
          </div>
          <div>
            <dt>Marge :</dt>
            <dd>{argent(e.marge)}</dd>
          </div>
          <div>
            <dt>Marge libre :</dt>
            <dd>{argent(e.margeLibre)}</dd>
          </div>
          <div>
            <dt>Niveau de marge (%) :</dt>
            <dd className={e.niveauMarge !== null && e.niveauMarge < 100 ? 'negatif' : ''}>{e.niveauMarge === null ? '' : argent(e.niveauMarge)}</dd>
          </div>
        </dl>
        <div className="mm-section">
          Positions<span>{compte.positions.length || ''}</span>
        </div>
        <ul className="mm-positions">
          {positions.map((p) => (
            <LignePosition key={p.ticket} p={p} voirGraphique={voirGraphique} />
          ))}
          {compte.positions.length === 0 && <li className="mm-vide">Aucune position ouverte</li>}
        </ul>
        {compte.ordres.length > 0 && (
          <>
            <div className="mm-section">
              Ordres<span>{compte.ordres.length}</span>
            </div>
            <ul className="mm-positions">
              {compte.ordres.map((o) => {
                const s = symbole(o.symbole)!;
                const q = cotations[o.symbole];
                return (
                  <li
                    key={o.ticket}
                    onClick={() =>
                      feuille(`#${o.ticket} ${o.symbole} ${LIBELLES_TYPE[o.type]}`, [
                        { libelle: "Modifier l'ordre", action: () => pousser({ type: 'ordre-attente', ticket: o.ticket }) },
                        { libelle: 'Graphique', action: () => voirGraphique(o.symbole) },
                      ])
                    }
                  >
                    <div className="mm-pos">
                      <div>
                        <span>
                          <b>{o.symbole}</b>, <span className={o.type.startsWith('buy') ? 'buy' : 'sell'}>{LIBELLES_TYPE[o.type]} {o.volume.toFixed(2)}</span>
                        </span>
                        <small>à {formaterPrix(s, o.prix)}</small>
                      </div>
                      <div className="mm-pos-droite">
                        <span className="muet">{q ? formaterPrix(s, o.type.startsWith('buy') ? q.ask : q.bid) : ''}</span>
                        <small>placé</small>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function LignePosition({ p, voirGraphique }: { p: Position; voirGraphique: (s: string) => void }) {
  const { cotations, operer, ouvrir } = useTerminal();
  const { pousser, feuille } = useNav();
  const [ouvert, setOuvert] = useState(false);
  const [decalage, setDecalage] = useState(0);
  const geste = useRef<{ x: number; y: number; base: number; horizontal: boolean | null; long: number | undefined; declenche: boolean } | null>(null);
  const s = symbole(p.symbole)!;
  const q = cotations[p.symbole];
  const profit = profitPosition(p, cotations);
  const LARGEUR = 168;
  const suiveur = (n: number) => () => operer((c) => ({ compte: definirSuiveur(c, p.ticket, n), erreur: null }), { silencieux: true });
  const menu = () =>
    feuille(`#${p.ticket} ${p.symbole}, ${p.type} ${p.volume.toFixed(2)}`, [
      { libelle: 'Fermer la position', danger: true, action: () => pousser({ type: 'fermer', ticket: p.ticket }) },
      { libelle: 'Modifier la position', action: () => pousser({ type: 'position', ticket: p.ticket }) },
      {
        libelle: `Stop suiveur${p.suiveur ? ` (${p.suiveur} pts)` : ''}`,
        action: () =>
          feuille('Stop suiveur', [
            { libelle: `Aucun${p.suiveur === 0 ? ' ✓' : ''}`, action: suiveur(0) },
            ...[50, 100, 200, 300, 500, 1000].map((n) => ({ libelle: `${n} points${p.suiveur === n ? ' ✓' : ''}`, action: suiveur(n) })),
            { libelle: 'Personnalisé…', action: () => ouvrir({ type: 'suiveur', ticket: p.ticket }) },
          ]),
      },
      { libelle: 'Nouvel ordre', action: () => pousser({ type: 'ordre', symbole: p.symbole }) },
      { libelle: 'Graphique', action: () => voirGraphique(p.symbole) },
    ]);
  // Gestes : toucher = détails, appui long = menu, glisser vers la gauche = boutons Fermer / Modifier (comme MT5 Android).
  const gestes = {
    onPointerDown: (e: React.PointerEvent) => {
      const g = { x: e.clientX, y: e.clientY, base: decalage, horizontal: null as boolean | null, long: undefined as number | undefined, declenche: false };
      g.long = window.setTimeout(() => {
        g.declenche = true;
        vibrer(15);
        menu();
      }, 500);
      geste.current = g;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = geste.current;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (g.horizontal === null && Math.hypot(dx, dy) > 8) {
        g.horizontal = Math.abs(dx) > Math.abs(dy);
        window.clearTimeout(g.long);
      }
      if (g.horizontal) setDecalage(Math.max(-LARGEUR, Math.min(0, g.base + dx)));
    },
    onPointerUp: () => {
      const g = geste.current;
      geste.current = null;
      if (!g) return;
      window.clearTimeout(g.long);
      if (g.horizontal) {
        setDecalage((d) => (d < -LARGEUR / 3 ? -LARGEUR : 0));
        return;
      }
      if (g.declenche || g.horizontal !== null) return;
      if (decalage) setDecalage(0);
      else setOuvert(!ouvert);
    },
    onPointerCancel: () => {
      if (geste.current) window.clearTimeout(geste.current.long);
      geste.current = null;
      setDecalage((d) => (d < -LARGEUR / 3 ? -LARGEUR : 0));
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (geste.current) window.clearTimeout(geste.current.long);
      geste.current = null;
      menu();
    },
  };
  return (
    <li className={`mm-glissable${ouvert ? ' ouvert' : ''}`}>
      <div className="mm-glisse-actions" style={{ width: LARGEUR }}>
        <button
          className="modifier"
          onClick={() => {
            setDecalage(0);
            pousser({ type: 'position', ticket: p.ticket });
          }}
        >
          Modifier
        </button>
        <button
          className="fermer"
          onClick={() => {
            setDecalage(0);
            const r = operer((c) => fermerPosition(c, p.ticket, cotations), { confirmation: false });
            vibrer(r.erreur ? 40 : 25);
          }}
        >
          Fermer
        </button>
      </div>
      <div className="mm-glisse-contenu" style={{ transform: `translateX(${decalage}px)`, transition: geste.current?.horizontal ? 'none' : undefined }} {...gestes}>
      <div className="mm-pos">
        <div>
          <span>
            <b>{p.symbole}</b>, <span className={p.type}>{p.type} {p.volume.toFixed(2)}</span>
          </span>
          <small>
            {formaterPrix(s, p.prixOuverture)} → {q ? formaterPrix(s, prixFermeture(p.type, q)) : '—'}
            {p.suiveur ? ' · ↻' : ''}
          </small>
        </div>
        <b className={`mm-profit ${profit >= 0 ? 'positif' : 'negatif'}`}>{argent(profit)}</b>
      </div>
      {ouvert && (
        <div className="mm-pos-detail" onClick={(e) => e.stopPropagation()}>
          <dl>
            <div>
              <dt>{dateMT(p.heure)}</dt>
              <dd>#{p.ticket}</dd>
            </div>
            <div>
              <dt>S/L :</dt>
              <dd>{p.sl ? formaterPrix(s, p.sl) : '—'}</dd>
            </div>
            <div>
              <dt>T/P :</dt>
              <dd>{p.tp ? formaterPrix(s, p.tp) : '—'}</dd>
            </div>
            <div>
              <dt>Swap :</dt>
              <dd>{argent(p.swap)}</dd>
            </div>
            {p.commentaire && (
              <div>
                <dt>Commentaire :</dt>
                <dd>{p.commentaire}</dd>
              </div>
            )}
          </dl>
          <div className="mm-actions-ligne">
            <button
              className="danger"
              onClick={() => {
                const r = operer((c) => fermerPosition(c, p.ticket, cotations), { confirmation: false });
                vibrer(r.erreur ? 40 : 20);
              }}
            >
              Fermer
            </button>
            <button onClick={() => pousser({ type: 'position', ticket: p.ticket })}>Modifier</button>
            <button onClick={() => voirGraphique(p.symbole)}>Graphique</button>
          </div>
        </div>
      )}
      </div>
    </li>
  );
}

// ---------- Historique ----------

type Mode = 'positions' | 'ordres' | 'transactions';
type Periode = 'jour' | 'semaine' | 'mois' | '3mois' | 'tout';
const PERIODES: [Periode, string][] = [
  ['jour', "Aujourd'hui"],
  ['semaine', 'Semaine dernière'],
  ['mois', 'Mois dernier'],
  ['3mois', '3 derniers mois'],
  ['tout', "Tout l'historique"],
];

export function Historique() {
  const { compte } = useTerminal();
  const { feuille, pousser } = useNav();
  const [mode, setMode] = useState<Mode>('positions');
  const [periode, setPeriode] = useState<Periode>('tout');
  const [symboleFiltre, setSymboleFiltre] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const depuis = useMemo(() => {
    const d = new Date();
    if (periode === 'jour') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (periode === 'semaine') return Date.now() - 7 * 86400000;
    if (periode === 'mois') return Date.now() - 30 * 86400000;
    if (periode === '3mois') return Date.now() - 91 * 86400000;
    return 0;
  }, [periode]);
  const deals = compte.transactions.filter((d) => d.heure >= depuis && (!symboleFiltre || d.symbole === symboleFiltre || d.type === 'balance'));
  const sorties = deals.filter((d) => d.entree === 'out');
  const somme = (f: (d: (typeof deals)[number]) => number) => deals.reduce((s, d) => s + f(d), 0);
  const profit = sorties.reduce((s, d) => s + d.profit, 0);
  const depot = somme((d) => (d.type === 'balance' && d.profit > 0 ? d.profit : 0));
  const retrait = somme((d) => (d.type === 'balance' && d.profit < 0 ? d.profit : 0));
  const symboles = [...new Set(compte.transactions.filter((d) => d.symbole).map((d) => d.symbole))];
  const courbe = useMemo(() => calculerStats(compte.transactions.filter((d) => d.heure >= depuis)).courbe, [compte.transactions, depuis]);
  return (
    <div className="mm-ecran">
      <EnTete
        titre="Historique"
        sousTitre={`${PERIODES.find((p) => p[0] === periode)![1]}${symboleFiltre ? ` · ${symboleFiltre}` : ''}`}
        gauche={
          <BoutonIcone
            titre="Symbole"
            onClick={() => feuille('Symbole', [{ libelle: 'Tous les symboles', action: () => setSymboleFiltre(null) }, ...symboles.map((sy) => ({ libelle: sy, action: () => setSymboleFiltre(sy) }))])}
          >
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M3 4h14l-5.5 6.5V16l-3 1.5v-7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </BoutonIcone>
        }
        droite={
          <BoutonIcone titre="Période" onClick={() => feuille('Période', PERIODES.map(([v, l]) => ({ libelle: `${l}${periode === v ? ' ✓' : ''}`, action: () => setPeriode(v) })))}>
            <svg viewBox="0 0 20 20" width="20" height="20">
              <rect x="3" y="4.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M3 8.5h14M7 2.5v4M13 2.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </BoutonIcone>
        }
      />
      <div className="mm-segments-cadre">
        <Segments<Mode>
          valeur={mode}
          changer={setMode}
          options={[
            ['positions', 'Positions'],
            ['ordres', 'Ordres'],
            ['transactions', 'Transactions'],
          ]}
        />
      </div>
      <div className="mm-defile">
        <dl className="mm-resume">
          <div>
            <dt>Profit :</dt>
            <dd className={profit >= 0 ? 'positif' : 'negatif'}>{argent(profit)}</dd>
          </div>
          <div>
            <dt>Crédit :</dt>
            <dd>0.00</dd>
          </div>
          <div>
            <dt>Dépôt :</dt>
            <dd>{argent(depot)}</dd>
          </div>
          <div>
            <dt>Retrait :</dt>
            <dd>{argent(retrait)}</dd>
          </div>
          <div>
            <dt>Swap :</dt>
            <dd>{argent(somme((d) => d.swap))}</dd>
          </div>
          <div>
            <dt>Commission :</dt>
            <dd>{argent(somme((d) => d.commission))}</dd>
          </div>
          <div>
            <dt>Solde :</dt>
            <dd>{argent(compte.solde)}</dd>
          </div>
        </dl>
        {mode === 'positions' && courbe.length > 1 && (
          <div className="mm-courbe">
            <CourbeSolde points={courbe} hauteur={130} />
          </div>
        )}
        <ul className="mm-positions">
          {mode === 'positions' &&
            sorties
              .slice()
              .reverse()
              .map((d) => {
                const s = symbole(d.symbole);
                const type = d.type === 'sell' ? 'buy' : 'sell';
                return (
                  <li key={d.ticket} onClick={() => setOuvert(ouvert === d.ticket ? null : d.ticket)}>
                    <div className="mm-pos">
                      <div>
                        <span>
                          <b>{d.symbole}</b>, <span className={type}>{type} {d.volume.toFixed(2)}</span>
                        </span>
                        <small>
                          {d.prixOuverture !== undefined ? formaterPrix(s, d.prixOuverture) : ''} → {formaterPrix(s, d.prix)}
                        </small>
                      </div>
                      <div className="mm-pos-droite">
                        <b className={d.profit >= 0 ? 'positif' : 'negatif'}>{argent(d.profit)}</b>
                        <small>{dateMT(d.heure, false)}</small>
                      </div>
                    </div>
                    {ouvert === d.ticket && (
                      <dl className="mm-pos-detail">
                        <div>
                          <dt>Ouverture :</dt>
                          <dd>{d.heureOuverture ? dateMT(d.heureOuverture) : '—'}</dd>
                        </div>
                        <div>
                          <dt>Position :</dt>
                          <dd>#{d.position}</dd>
                        </div>
                        <div>
                          <dt>S/L :</dt>
                          <dd>{d.sl ? formaterPrix(s, d.sl) : '—'}</dd>
                        </div>
                        <div>
                          <dt>T/P :</dt>
                          <dd>{d.tp ? formaterPrix(s, d.tp) : '—'}</dd>
                        </div>
                        <div>
                          <dt>Swap / commission :</dt>
                          <dd>
                            {argent(d.swap)} / {argent(d.commission)}
                          </dd>
                        </div>
                        {d.commentaire && (
                          <div>
                            <dt>Commentaire :</dt>
                            <dd>{d.commentaire}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </li>
                );
              })}
          {mode === 'ordres' &&
            compte.ordresHisto
              .filter((o) => o.heureFin >= depuis && (!symboleFiltre || o.symbole === symboleFiltre))
              .slice()
              .reverse()
              .map((o) => {
                const s = symbole(o.symbole);
                return (
                  <li key={`${o.ticket}-${o.heureFin}`}>
                    <div className="mm-pos">
                      <div>
                        <span>
                          <b>{o.symbole}</b>, <span className={o.type.startsWith('buy') ? 'buy' : 'sell'}>{LIBELLES_TYPE[o.type]} {o.volume.toFixed(2)}</span>
                        </span>
                        <small>à {formaterPrix(s, o.prix)}</small>
                      </div>
                      <div className="mm-pos-droite">
                        <span className={o.etat === 'rempli' ? '' : 'muet'}>{o.etat}</span>
                        <small>{dateMT(o.heureFin, false)}</small>
                      </div>
                    </div>
                  </li>
                );
              })}
          {mode === 'transactions' &&
            deals
              .slice()
              .reverse()
              .map((d) => {
                const s = symbole(d.symbole);
                return (
                  <li key={d.ticket}>
                    <div className="mm-pos">
                      <div>
                        {d.type === 'balance' ? (
                          <b>Balance</b>
                        ) : (
                          <span>
                            <b>{d.symbole}</b>, <span className={d.type}>{d.type} {d.entree} {d.volume.toFixed(2)}</span>
                          </span>
                        )}
                        <small>{d.type === 'balance' ? d.commentaire : `à ${formaterPrix(s, d.prix)} · #${d.ticket}`}</small>
                      </div>
                      <div className="mm-pos-droite">
                        <b className={d.profit > 0 ? 'positif' : d.profit < 0 ? 'negatif' : ''}>{d.entree === 'in' ? '' : argent(d.profit)}</b>
                        <small>{dateMT(d.heure, false)}</small>
                      </div>
                    </div>
                  </li>
                );
              })}
        </ul>
        {mode === 'positions' && sorties.length === 0 && <div className="mm-vide">Aucune position fermée sur la période.</div>}
        <div className="mm-boutons-bas statique">
          <button className="mm-bouton secondaire" onClick={() => pousser({ type: 'rapport' })}>
            Rapport détaillé
          </button>
        </div>
      </div>
    </div>
  );
}
