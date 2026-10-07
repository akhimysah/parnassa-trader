import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cotation } from '../marche/cotations';
import { useTerminal } from '../contexte';
import { MESSAGES } from '../composants/BoiteOutils';
import { ContexteNav, FeuilleActions, ICONES, type Action, type Ecran, type Onglet } from './commun';
import { AjouterSymbole, Cotations, EditerCotations, ProprietesSymbole } from './Cotations';
import { GraphiqueMobile } from './GraphiqueMobile';
import { EcranFermer, EcranOrdre, EcranOrdreAttente, EcranPosition, EcranResultat } from './Ordre';
import { Historique, Trade } from './Trade';
import { Comptes, EcranListe, OuvrirCompte, Reglages } from './Reglages';
import { EcranAlerte, EcranDepot, EcranExpert, EcranExperts, EcranIndicateur, EcranIndicateurs, EcranProfondeur, EcranRapport, EcranSuiveur, EcranUnClic } from './Outils';
import { Bienvenue, bienvenueVue } from './Bienvenue';
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
  const { etat, majGraphique, compte, cotations } = useTerminal();
  const connexion = useConnexion(cotations);
  const [onglet, setOnglet] = useState<Onglet>('cotations');
  const [pile, setPile] = useState<Ecran[]>([]);
  const [feuille, setFeuille] = useState<{ titre: string | null; actions: Action[] } | null>(null);
  const [accueil, setAccueil] = useState(() => !bienvenueVue());

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

  // Tablette (iPad, grand téléphone en paysage…) : cotations toujours à gauche, onglet actif à droite.
  const racineRef = useRef<HTMLDivElement>(null);
  const [tablette, setTablette] = useState(false);
  useEffect(() => {
    const el = racineRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTablette(el.clientWidth >= 700 && el.clientHeight >= 500));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Sur tablette, l'onglet Cotations est la colonne de gauche : la partie droite montre alors le graphique.
  const ongletDroit: Onglet = tablette && onglet === 'cotations' ? 'graphique' : onglet;

  const haut = pile[pile.length - 1];
  const nonLus = MESSAGES.filter((m) => !etat.lus.includes(m.id)).length;
  const positions = compte.positions.length;

  return (
    <ContexteNav.Provider value={nav}>
      <div ref={racineRef} className={`mm${cadre ? ' cadre' : ''}${tablette ? ' tablette' : ''}${!haut ? ` onglet-${ongletDroit}` : ''}`}>
        {connexion !== 'ok' && <div className={`mm-connexion ${connexion}`}>{connexion === 'hors-ligne' ? 'Pas de connexion — les cotations reprendront au retour du réseau' : 'Connexion lente — cotations en attente…'}</div>}
        <div className={`mm-pile${tablette ? ' tablette' : ''}`}>
          {tablette && (
            <div className="mm-colonne-cotations">
              <Cotations voirGraphique={voirGraphique} />
            </div>
          )}
          <div className="mm-colonne-principale">
            {/* Les onglets restent en place sous la pile : le graphique ne recharge pas son historique. */}
            <div className="mm-racine" style={{ display: haut ? 'none' : undefined }}>
              {ongletDroit === 'cotations' && <Cotations voirGraphique={voirGraphique} />}
              <div className="mm-conteneur-graphique" style={{ display: ongletDroit === 'graphique' ? undefined : 'none' }}>
                <GraphiqueMobile />
              </div>
              {ongletDroit === 'trade' && <Trade voirGraphique={voirGraphique} />}
              {ongletDroit === 'historique' && <Historique />}
              {ongletDroit === 'parametres' && <Reglages />}
            </div>
            {haut && (
              <div className="mm-ecran-pile" key={pile.length}>
                <EcranPile e={haut} />
              </div>
            )}
          </div>
        </div>
        {(!haut || tablette) && (
          <nav className="mm-onglets">
            {ONGLETS.filter(([id]) => !tablette || id !== 'cotations').map(([id, l]) => (
              <button key={id} className={ongletDroit === id ? 'actif' : ''} onClick={() => setOnglet(id)}>
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
        {accueil && <Bienvenue fermer={() => setAccueil(false)} />}
      </div>
    </ContexteNav.Provider>
  );
}

function EcranPile({ e }: { e: Ecran }) {
  switch (e.type) {
    case 'ordre':
      return <EcranOrdre symboleInitial={e.symbole} attente={e.attente} typeInitial={e.typeAttente} prixInitial={e.prix} />;
    case 'resultat':
      return <EcranResultat ok={e.ok} titre={e.titre} texte={e.texte} symbole={e.symbole} />;
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
    case 'rapport':
      return <EcranRapport />;
    case 'indicateurs':
      return <EcranIndicateurs />;
    case 'indicateur':
      return <EcranIndicateur type={e.indicateur} existant={e.existant} />;
    case 'alerte':
      return <EcranAlerte id={e.id} symboleInitial={e.symbole} />;
    case 'profondeur':
      return <EcranProfondeur nom={e.symbole} />;
    case 'experts':
      return <EcranExperts />;
    case 'expert':
      return <EcranExpert graphique={e.graphique} expert={e.expert} />;
    case 'depot':
      return <EcranDepot />;
    case 'unclic':
      return <EcranUnClic />;
    case 'suiveur':
      return <EcranSuiveur ticket={e.ticket} />;
  }
}

/** État du réseau comme l'indicateur de connexion de MT5 : hors ligne, ou plus aucune cotation depuis 20 s. */
function useConnexion(cotations: Record<string, Cotation>): 'ok' | 'lente' | 'hors-ligne' {
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    const h = () => setEnLigne(navigator.onLine);
    window.addEventListener('online', h);
    window.addEventListener('offline', h);
    const t = window.setInterval(() => setMaintenant(Date.now()), 5000);
    return () => {
      window.removeEventListener('online', h);
      window.removeEventListener('offline', h);
      window.clearInterval(t);
    };
  }, []);
  if (!enLigne) return 'hors-ligne';
  const derniere = Math.max(0, ...Object.values(cotations).map((c) => c.heure));
  // Au démarrage (aucune cotation encore), pas d'alerte avant 20 s.
  if (derniere === 0) return maintenant - DEMARRAGE > 20000 ? 'lente' : 'ok';
  return maintenant - derniere > 20000 && document.visibilityState === 'visible' ? 'lente' : 'ok';
}

const DEMARRAGE = Date.now();
