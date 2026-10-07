import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTerminal } from '../contexte';
import { MESSAGES } from '../composants/BoiteOutils';
import { ContexteNav, FeuilleActions, ICONES, type Action, type Ecran, type Onglet } from './commun';
import { AjouterSymbole, Cotations, EditerCotations, ProprietesSymbole } from './Cotations';
import { GraphiqueMobile } from './GraphiqueMobile';
import { EcranFermer, EcranOrdre, EcranOrdreAttente, EcranPosition, EcranResultat } from './Ordre';
import { Historique, Trade } from './Trade';
import { Comptes, EcranListe, OuvrirCompte, Reglages } from './Reglages';
import './mobile.css';

const ONGLETS: [Onglet, string][] = [
  ['cotations', 'Cotations'],
  ['graphique', 'Graphique'],
  ['trade', 'Trade'],
  ['historique', 'Historique'],
  ['parametres', 'Paramètres'],
];

/** Interface téléphone, organisée comme l'application MetaTrader 5 mobile. */
export function Mobile({ cadre = false }: { cadre?: boolean }) {
  const { etat, majGraphique, compte } = useTerminal();
  const [onglet, setOnglet] = useState<Onglet>('cotations');
  const [pile, setPile] = useState<Ecran[]>([]);
  const [feuille, setFeuille] = useState<{ titre: string | null; actions: Action[] } | null>(null);

  const pousser = useCallback((e: Ecran) => setPile((p) => [...p, e]), []);
  const retour = useCallback(() => setPile((p) => p.slice(0, -1)), []);
  const racine = useCallback((o?: Onglet) => {
    setPile([]);
    if (o) setOnglet(o);
  }, []);
  const nav = useMemo(
    () => ({ onglet, changerOnglet: setOnglet, pousser, retour, racine, feuille: (titre: string | null, actions: Action[]) => setFeuille({ titre, actions }) }),
    [onglet, pousser, retour, racine],
  );

  // Bouton « précédent » du téléphone : revient d'un écran dans la pile plutôt que de quitter l'application.
  useEffect(() => {
    if (pile.length === 0) return;
    window.history.pushState({ mobile: pile.length }, '');
    const h = () => setPile((p) => p.slice(0, -1));
    window.addEventListener('popstate', h);
    return () => window.removeEventListener('popstate', h);
  }, [pile.length]);

  const voirGraphique = useCallback(
    (sym: string) => {
      const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif) ?? etat.graphiques[0];
      if (g) majGraphique(g.id, { symbole: sym });
      setPile([]);
      setOnglet('graphique');
    },
    [etat.graphiques, etat.graphiqueActif, majGraphique],
  );

  const haut = pile[pile.length - 1];
  const nonLus = MESSAGES.filter((m) => !etat.lus.includes(m.id)).length;
  const positions = compte.positions.length;

  return (
    <ContexteNav.Provider value={nav}>
      <div className={`mm${cadre ? ' cadre' : ''}`}>
        <div className="mm-pile">
          {/* Les onglets restent en place sous la pile : le graphique ne recharge pas son historique. */}
          <div className="mm-racine" style={{ display: haut ? 'none' : undefined }}>
            {onglet === 'cotations' && <Cotations voirGraphique={voirGraphique} />}
            <div className="mm-conteneur-graphique" style={{ display: onglet === 'graphique' ? undefined : 'none' }}>
              <GraphiqueMobile />
            </div>
            {onglet === 'trade' && <Trade voirGraphique={voirGraphique} />}
            {onglet === 'historique' && <Historique />}
            {onglet === 'parametres' && <Reglages />}
          </div>
          {haut && (
            <div className="mm-ecran-pile" key={pile.length}>
              <EcranPile e={haut} />
            </div>
          )}
        </div>
        {!haut && (
          <nav className="mm-onglets">
            {ONGLETS.map(([id, l]) => (
              <button key={id} className={onglet === id ? 'actif' : ''} onClick={() => setOnglet(id)}>
                <span className="mm-onglet-icone">
                  {ICONES[id]}
                  {id === 'parametres' && nonLus > 0 && <i className="mm-point" />}
                  {id === 'trade' && positions > 0 && <i className="mm-nombre">{positions}</i>}
                </span>
                {l}
              </button>
            ))}
          </nav>
        )}
        {feuille && <FeuilleActions titre={feuille.titre} actions={feuille.actions} fermer={() => setFeuille(null)} />}
      </div>
    </ContexteNav.Provider>
  );
}

function EcranPile({ e }: { e: Ecran }) {
  switch (e.type) {
    case 'ordre':
      return <EcranOrdre symboleInitial={e.symbole} attente={e.attente} />;
    case 'resultat':
      return <EcranResultat ok={e.ok} titre={e.titre} texte={e.texte} />;
    case 'position':
      return <EcranPosition ticket={e.ticket} />;
    case 'fermer':
      return <EcranFermer ticket={e.ticket} />;
    case 'ordre-attente':
      return <EcranOrdreAttente ticket={e.ticket} />;
    case 'symbole':
      return <ProprietesSymbole nom={e.symbole} />;
    case 'ajouter':
      return <AjouterSymbole />;
    case 'editer':
      return <EditerCotations />;
    case 'comptes':
      return <Comptes />;
    case 'ouvrir-compte':
      return <OuvrirCompte />;
    case 'liste':
      return <EcranListe quoi={e.quoi} />;
  }
}
