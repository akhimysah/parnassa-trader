import { useEffect, useMemo, useState } from 'react';
import { ContexteTerminal, type Survol, type Terminal } from './contexte';
import { chargerEtat, type EtatTerminal } from './etat';
import { definirAbonnements, definirTypeCompte, useCotations } from './marche/cotations';
import { definirExpertsPerso } from './algo/experts';
import { FenetreGraphique } from './graphique/FenetreGraphique';
import type { Synchro } from './synchro';
import type { ComptesEnLigne } from './compte/enLigne';

const refus = 'Fenêtre détachée : passez vos ordres depuis la fenêtre principale de Parnassa Trader.';

/**
 * Graphique détaché dans sa propre fenêtre (second écran), comme les fenêtres flottantes de MT5. Il suit l'état du
 * terminal principal (positions, objets, indicateurs) par le stockage du navigateur ; il n'écrit rien et ne trade
 * pas, pour qu'un seul terminal fasse tourner le moteur.
 */
export function VueDetachee({ id }: { id: string }) {
  const [etat, setEtat] = useState<EtatTerminal>(chargerEtat);
  const [survol, setSurvol] = useState<Survol | null>(null);
  const cotations = useCotations();
  definirExpertsPerso(etat.expertsPerso);
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key === 'parnassa-trader:v1') setEtat(chargerEtat());
    };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }, []);
  const g = etat.graphiques.find((x) => x.id === id);
  const compte = etat.comptes.find((c) => c.login === etat.actif) ?? etat.comptes[0];
  useEffect(() => {
    if (g) definirAbonnements([g.symbole]);
    document.title = g ? `${g.symbole},${g.periode} — Parnassa Trader` : 'Parnassa Trader';
  }, [g?.symbole, g?.periode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => definirTypeCompte(compte.type ?? 'standard'), [compte.type]);
  useEffect(() => {
    document.documentElement.dataset.theme = etat.theme;
  }, [etat.theme]);

  const synchro = useMemo<Synchro>(() => ({ statut: 'deconnecte', compte: null, derniereSynchro: null, erreur: null, synchroniser: () => undefined, deconnecter: async () => undefined }), []);
  const enLigne = useMemo<ComptesEnLigne>(() => {
    const non = () => Promise.reject(new Error(refus));
    return { statut: () => 'connecte', erreur: () => null, ouvrir: non, connecter: non, mesComptes: async () => null, connecterProprietaire: non, nouveauxMotsDePasse: non, fermerCompte: non, renommer: non, deconnecter: async () => undefined };
  }, []);
  if (!g) return <div className="chargement-app">Ce graphique a été fermé dans le terminal.</div>;
  const terminal: Terminal = {
    etat: { ...etat, graphiques: etat.graphiques.map((x) => (x.id === id ? { ...x, unClic: false } : x)) },
    maj: () => undefined,
    compte,
    cotations,
    operer: (_f, _o) => ({ compte, erreur: refus }),
    dialogue: null,
    ouvrir: () => undefined,
    fermer: () => undefined,
    majGraphique: () => undefined,
    ouvrirGraphique: () => undefined,
    signaler: () => undefined,
    survol: setSurvol,
    survolActuel: survol,
    outil: null,
    choisirOutil: () => undefined,
    mobile: false,
    synchro,
    enLigne,
  };
  return (
    <ContexteTerminal.Provider value={terminal}>
      <div className="vue-detachee">
        <FenetreGraphique g={{ ...g, unClic: false }} actif activer={() => undefined} />
      </div>
    </ContexteTerminal.Provider>
  );
}
