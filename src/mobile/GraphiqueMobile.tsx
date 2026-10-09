import { useTerminal } from '../contexte';
import { identifiant, nouveauGraphique } from '../etat';
import { PERIODES } from '../marche/bougies';
import { formaterPrix, symbole } from '../marche/symboles';
import type { TypeEnAttente } from '../compte/moteur';
import { FenetreGraphique } from '../graphique/FenetreGraphique';
import { registreGraphiques } from '../graphique/registre';
import { useRef } from 'react';
import { BoutonIcone, EnTete, IconePlus, useNav, vibrer } from './commun';
import { OBJETS } from '../graphique/dessins';

/** Graphique plein écran avec les barres de commandes de MT5 mobile. */
export function GraphiqueMobile() {
  const { etat, maj, majGraphique, choisirOutil, outil, ouvrir, cotations, survolActuel, signaler } = useTerminal();
  const { feuille, pousser } = useNav();
  const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif) ?? etat.graphiques[0];
  if (!g) {
    const creer = () => {
      const ng = nouveauGraphique(etat.observation[0] ?? 'EURUSD');
      maj((e) => ({ ...e, graphiques: [ng], graphiqueActif: ng.id }));
    };
    return (
      <div className="mm-ecran">
        <EnTete titre="Graphique" />
        <div className="mm-vide grand">
          Aucun graphique ouvert.{' '}
          <button className="mm-lien" onClick={creer}>
            Ouvrir un graphique
          </button>
        </div>
      </div>
    );
  }
  const s = symbole(g.symbole)!;
  const q = cotations[g.symbole];
  // Glisser l'en-tête à gauche / à droite : symbole suivant / précédent de la liste des cotations.
  const suivant = (sens: 1 | -1) => {
    const liste = etat.observation;
    const i = liste.indexOf(g.symbole);
    const n = liste[(i + sens + liste.length) % liste.length];
    if (!n || n === g.symbole) return;
    vibrer(10);
    majGraphique(g.id, { symbole: n });
  };
  // Appui long sur le graphique : ordres en attente, alerte ou ligne au prix pointé (comme le réticule de MT5 mobile).
  const auPrix = (brut: number) => {
    vibrer(15);
    const prix = Number(brut.toFixed(s.chiffres));
    const f = formaterPrix(s, prix);
    const attente = (t: TypeEnAttente, l: string) => ({ libelle: `${l} à ${f}`, action: () => pousser({ type: 'ordre', symbole: g.symbole, typeAttente: t, prix }) });
    const ordres = !q ? [] : prix < q.bid ? [attente('buy_limit', 'Buy Limit'), attente('sell_stop', 'Sell Stop')] : prix > q.ask ? [attente('sell_limit', 'Sell Limit'), attente('buy_stop', 'Buy Stop')] : [];
    const alerte = (condition: 'bid>' | 'bid<') => () => {
      maj((e) => ({ ...e, alertes: [...e.alertes, { id: identifiant(), symbole: g.symbole, condition, valeur: prix, active: true, commentaire: '' }] }));
      signaler(`Alerte créée : ${g.symbole} Bid ${condition.endsWith('>') ? '>' : '<'} ${f}`);
    };
    feuille(`${g.symbole} à ${f}`, [
      ...ordres,
      { libelle: `Alerte quand le Bid ${q && prix > q.bid ? 'dépasse' : 'passe sous'} ${f}`, action: alerte(q && prix > q.bid ? 'bid>' : 'bid<') },
      { libelle: `Ligne horizontale à ${f}`, action: () => majGraphique(g.id, (gr) => ({ objets: [...gr.objets, { id: identifiant(), type: 'horizontale', points: [{ t: 0, prix }], couleur: '#ff3b30' }] })) },
      { libelle: 'Nouvel ordre au marché', action: () => pousser({ type: 'ordre', symbole: g.symbole }) },
    ]);
  };
  const d = survolActuel;
  const changerSymbole = () => feuille('Symbole', etat.observation.map((n) => ({ libelle: `${n} — ${symbole(n)?.description}`, action: () => majGraphique(g.id, { symbole: n }) })));
  const indicateurs = () => pousser({ type: 'indicateurs' });
  const objets = () =>
    feuille('Objets', [
      ...(Object.keys(OBJETS) as (keyof typeof OBJETS)[]).map((o) => ({ libelle: OBJETS[o].nom, action: () => choisirOutil(o) })),
      ...(g.objets.length ? [{ libelle: `Supprimer les ${g.objets.length} objets`, danger: true, action: () => majGraphique(g.id, { objets: [] }) }] : []),
    ]);
  const reglages = () =>
    feuille('Graphique', [
      { libelle: `Bougies${g.type === 'bougies' ? ' ✓' : ''}`, action: () => majGraphique(g.id, { type: 'bougies' }) },
      { libelle: `Barres${g.type === 'barres' ? ' ✓' : ''}`, action: () => majGraphique(g.id, { type: 'barres' }) },
      { libelle: `Ligne${g.type === 'ligne' ? ' ✓' : ''}`, action: () => majGraphique(g.id, { type: 'ligne' }) },
      { libelle: `${g.unClic ? 'Masquer' : 'Afficher'} le trading en un clic`, action: () => majGraphique(g.id, { unClic: !g.unClic }) },
      { libelle: `${g.niveauxTrading ? 'Masquer' : 'Afficher'} les niveaux de trading`, action: () => majGraphique(g.id, { niveauxTrading: !g.niveauxTrading }) },
      { libelle: `${g.indicateurs.some((i) => i.type === 'volumes') ? 'Masquer' : 'Afficher'} les volumes`, action: () => majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.some((i) => i.type === 'volumes') ? gr.indicateurs.filter((i) => i.type !== 'volumes') : [...gr.indicateurs, { id: identifiant(), type: 'volumes', p: {}, couleur: '#32cd32' }] })) },
      { libelle: 'Couleurs et propriétés…', action: () => ouvrir({ type: 'proprietes', graphique: g.id }) },
      { libelle: 'Expert Advisor…', action: () => pousser({ type: 'expert', graphique: g.id, expert: g.expert?.type }) },
      { libelle: 'Enregistrer comme image', action: () => registreGraphiques.get(g.id)?.capturer() },
    ]);
  return (
    <div className="mm-ecran mm-ecran-graphique">
      <GlisserEntete suivant={suivant}>
      <EnTete
        titre={
          <button className="mm-titre-bouton" onClick={changerSymbole}>
            {g.symbole} ▾
          </button>
        }
        sousTitre={s.description}
        gauche={
          <BoutonIcone titre="Réglages du graphique" onClick={reglages}>
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M3 5h9M15 5h2M3 10h2M8 10h9M3 15h7M13 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="13.5" cy="5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="6.5" cy="10" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="11.5" cy="15" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </BoutonIcone>
        }
        droite={
          <BoutonIcone titre="Nouvel ordre" onClick={() => pousser({ type: 'ordre', symbole: g.symbole })}>
            <IconePlus />
          </BoutonIcone>
        }
      />
      </GlisserEntete>
      <div className="mm-barre-graphique">
        <div className="mm-periodes">
          {PERIODES.map((p) => (
            <button key={p.id} className={g.periode === p.id ? 'actif' : ''} onClick={() => majGraphique(g.id, { periode: p.id })}>
              {p.id}
            </button>
          ))}
        </div>
        <button className="mm-outil" onClick={indicateurs} aria-label="Indicateurs">
          <i>f</i>
          {g.indicateurs.length > 0 && <sup>{g.indicateurs.length}</sup>}
        </button>
        <button className={`mm-outil${outil ? ' actif' : ''}`} onClick={() => (outil ? choisirOutil(null) : objets())} aria-label="Objets">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <path d="M3 16L17 4" stroke="currentColor" strokeWidth="1.7" />
            <circle cx="3.5" cy="15.5" r="1.8" fill="currentColor" />
            <circle cx="16.5" cy="4.5" r="1.8" fill="currentColor" />
          </svg>
        </button>
      </div>
      <div className="mm-graphique">
        <FenetreGraphique g={g} actif activer={() => undefined} appuiLong={auPrix} appuiLigne={(genre, ticket) => { vibrer(15); pousser(genre === 'ordre' ? { type: 'ordre-attente', ticket } : { type: 'position', ticket }); }} />
        {d && (
          <div className="mm-donnees">
            {new Date(d.temps).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} O <b>{d.o.toFixed(d.chiffres)}</b> H <b>{d.h.toFixed(d.chiffres)}</b> B <b>{d.l.toFixed(d.chiffres)}</b> C <b>{d.c.toFixed(d.chiffres)}</b>
          </div>
        )}
      </div>
    </div>
  );
}

function GlisserEntete({ suivant, children }: { suivant: (sens: 1 | -1) => void; children: React.ReactNode }) {
  const depart = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="mm-glisser-entete"
      onPointerDown={(e) => {
        depart.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const d = depart.current;
        depart.current = null;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - d.y) * 2) suivant(dx < 0 ? 1 : -1);
      }}
    >
      {children}
    </div>
  );
}
