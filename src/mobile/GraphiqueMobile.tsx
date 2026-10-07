import { useTerminal } from '../contexte';
import { identifiant, nouveauGraphique } from '../etat';
import { PERIODES } from '../marche/bougies';
import { symbole } from '../marche/symboles';
import { DEFINITIONS, nomCourt } from '../graphique/indicateurs';
import { FenetreGraphique } from '../graphique/FenetreGraphique';
import { registreGraphiques } from '../graphique/registre';
import { BoutonIcone, EnTete, IconePlus, useNav } from './commun';

/** Graphique plein écran avec les barres de commandes de MT5 mobile. */
export function GraphiqueMobile() {
  const { etat, maj, majGraphique, choisirOutil, outil, ouvrir } = useTerminal();
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
  const changerSymbole = () => feuille('Symbole', etat.observation.map((n) => ({ libelle: `${n} — ${symbole(n)?.description}`, action: () => majGraphique(g.id, { symbole: n }) })));
  const indicateurs = () =>
    feuille('Indicateurs', [
      ...g.indicateurs.map((i) => ({ libelle: `Retirer ${nomCourt(i)}`, danger: true, action: () => majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.filter((x) => x.id !== i.id) })) })),
      ...DEFINITIONS.map((d) => ({ libelle: `Ajouter ${d.nom}`, action: () => ouvrir({ type: 'indicateur', indicateur: d.type, graphique: g.id }) })),
    ]);
  const objets = () =>
    feuille('Objets', [
      { libelle: 'Ligne horizontale', action: () => choisirOutil('horizontale') },
      { libelle: 'Ligne de tendance', action: () => choisirOutil('tendance') },
      { libelle: 'Retracement de Fibonacci', action: () => choisirOutil('fibo') },
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
      { libelle: 'Expert Advisor…', action: () => ouvrir({ type: 'expert', graphique: g.id, expert: g.expert?.type }) },
      { libelle: 'Enregistrer comme image', action: () => registreGraphiques.get(g.id)?.capturer() },
    ]);
  return (
    <div className="mm-ecran mm-ecran-graphique">
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
        <FenetreGraphique g={g} actif activer={() => undefined} />
      </div>
    </div>
  );
}
