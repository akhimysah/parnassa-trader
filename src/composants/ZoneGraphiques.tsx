import { useTerminal } from '../contexte';
import { FenetreGraphique } from '../graphique/FenetreGraphique';
import { useMenuContextuel } from './ui';
import { useActions } from './Barres';

/** Zone centrale : fenêtres graphiques en onglets (comme MT5) ou en mosaïque. */
export function ZoneGraphiques() {
  const { etat, maj, majGraphique } = useTerminal();
  const { fermerGraphique } = useActions();
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const mosaique = etat.disposition === 'mosaique' && etat.graphiques.length > 1;
  const n = etat.graphiques.length;
  const colonnes = Math.ceil(Math.sqrt(n));
  const lignes = Math.ceil(n / colonnes);
  const activer = (id: string) => etat.graphiqueActif !== id && maj((e) => ({ ...e, graphiqueActif: id }));

  return (
    <div className="zone-graphiques">
      <div
        className={`graphiques ${mosaique ? 'mosaique' : 'onglets'}`}
        style={mosaique ? { gridTemplateColumns: `repeat(${colonnes}, 1fr)`, gridTemplateRows: `repeat(${lignes}, 1fr)` } : undefined}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          // Déposer un symbole de l'Observation du marché sur un graphique change son symbole.
          const sym = e.dataTransfer.getData('text/symbole');
          if (sym && etat.graphiqueActif) majGraphique(etat.graphiqueActif, { symbole: sym });
        }}
      >
        {etat.graphiques.map((g) => (
          <div key={g.id} className={`case-graphique${g.id === etat.graphiqueActif ? ' active' : ''}`} style={!mosaique && g.id !== etat.graphiqueActif ? { visibility: 'hidden' } : undefined}>
            {mosaique && (
              <div className="case-titre" onMouseDown={() => activer(g.id)}>
                <span>
                  {g.symbole},{g.periode}
                </span>
                <button onClick={() => fermerGraphique(g.id)} aria-label="Fermer">
                  ✕
                </button>
              </div>
            )}
            <FenetreGraphique g={g} actif={g.id === etat.graphiqueActif} activer={() => activer(g.id)} />
          </div>
        ))}
        {etat.graphiques.length === 0 && <div className="vide-graphiques">Aucun graphique ouvert. Fichier → Nouveau graphique, ou double-cliquez sur un symbole.</div>}
      </div>
      <div className="onglets-graphiques">
        {etat.graphiques.map((g) => (
          <button
            key={g.id}
            className={g.id === etat.graphiqueActif ? 'actif' : ''}
            onClick={() => activer(g.id)}
            onMouseDown={(e) => e.button === 1 && fermerGraphique(g.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              ouvrirMenu(e.clientX, e.clientY, [
                { libelle: 'Fermer', action: () => fermerGraphique(g.id) },
                { libelle: 'Fermer les autres', action: () => maj((x) => ({ ...x, graphiques: x.graphiques.filter((k) => k.id === g.id), graphiqueActif: g.id })) },
              ]);
            }}
          >
            {g.symbole},{g.periode}
            <span
              className="onglet-fermer"
              onClick={(e) => {
                e.stopPropagation();
                fermerGraphique(g.id);
              }}
            >
              ✕
            </span>
          </button>
        ))}
      </div>
      {menu}
    </div>
  );
}
