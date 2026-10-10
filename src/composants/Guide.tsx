import { useState } from 'react';
import { useTerminal } from '../contexte';
import { Fenetre } from './ui';

/** Guide de Parnassa Trader : chaque fonction, où la trouver et comment s'en servir (F1). */
const SECTIONS: { titre: string; points: string[] }[] = [
  {
    titre: 'Démarrer',
    points: [
      'Compte de démonstration : argent fictif, cotations réelles (Swissquote pour l’or, les métaux et le forex, Binance pour la crypto).',
      'Compte local (Parnassa-Demo) : gardé dans ce navigateur. Compte en ligne (Parnassa-Trader) : numéro, mot de passe et serveur, utilisable sur tous vos appareils (Fichier → Ouvrir un compte).',
      'Compte Parnassa relié (Fichier → Compte Parnassa et synchronisation) : graphiques, alertes, modèles et experts suivent sur tous vos appareils.',
    ],
  },
  {
    titre: 'Passer des ordres',
    points: [
      'F9 : nouvel ordre au marché ou en attente (limit, stop, stop-limit) avec S/L, T/P, expiration.',
      'Volume selon le risque : choisissez un % des fonds propres, posez un S/L, puis « Ajuster le volume ». Le ratio gain/risque s’affiche avec le T/P.',
      'Trading en un clic (Alt+T) : boutons SELL / BUY sur le graphique, volume modifiable directement.',
      'Sur le graphique, tirez la ligne d’une position pour créer un S/L ou un T/P ; une bulle montre le résultat en USD. Double-clic sur une ligne : la modifier.',
      'Clic droit sur une position : fermeture partielle, stop suiveur, break-even (tout de suite ou après N points), Fermer par.',
      'Gestion du risque (Outils → Gestion du risque) : perte du jour maximale (avec fermeture automatique), nombre de positions et volume maximaux ; au-delà, les nouveaux ordres sont refusés.',
    ],
  },
  {
    titre: 'Graphiques',
    points: [
      'Types : barres (Alt+1), bougies (Alt+2), ligne (Alt+3), Heikin Ashi (Alt+4). Périodes M1 à MN.',
      'Navigation rapide : tapez « GBPUSD », « H4 » ou « XAUUSD,M15 » sur un graphique puis Entrée.',
      'Objets : lignes horizontale, verticale, de tendance, Fibonacci, rectangle, canal équidistant, texte. Tirez les poignées ou le tracé ; double-clic pour leurs propriétés. Ctrl+Z annule le dernier changement des objets ou indicateurs.',
      'Séparateurs de périodes (Ctrl+Y), calendrier économique (triangles en bas, détail au survol), trajets des trades fermés.',
      'Fenêtre de données (Ctrl+D) : OHLC et valeur de chaque indicateur sous le réticule.',
      'Modèles (Graphiques → Modèle) et profils (Fichier → Profils) : enregistrer une présentation ou un ensemble de graphiques.',
    ],
  },
  {
    titre: 'Indicateurs',
    points: [
      '29 indicateurs MT5 : tendance, oscillateurs, volumes, Bill Williams. Glissez-les du Navigateur sur un graphique.',
      '« Appliquer à » : un autre prix (médian, typique…) ou les données d’un autre indicateur (par exemple une moyenne mobile du RSI).',
      'Niveaux personnalisés (ex. RSI 20 ; 50 ; 80) et épaisseur des lignes dans la fenêtre de l’indicateur.',
      'Indicateurs personnalisés par formule (groupe Personnalisés) : ex. « ema(close, 20) - ema(close, 50) » ou « highest(high, 20) ; lowest(low, 20) », en sous-fenêtre ou sur le graphique.',
    ],
  },
  {
    titre: 'Experts et testeur',
    points: [
      'Experts intégrés ou créés sans code avec l’assistant (Outils → Assistant de création d’expert) : conditions de croisement et de comparaison.',
      'Chaque expert a volume, S/L, T/P, stop suiveur et break-even. Algo Trading (Ctrl+E) l’autorise à trader ; il ne trade que si l’application est ouverte.',
      'Testeur (Ctrl+R) : backtest, mode visuel, avant-test (forward), optimisation complète ou génétique, carte 2D, rapport HTML.',
    ],
  },
  {
    titre: 'Alertes et rapports',
    points: [
      'Alertes de prix (Bid / Ask) ou d’heure, avec nombre de déclenchements, pause et expiration ; son et notification.',
      'Rapport de trading (Affichage → Rapport) et rapport HTML enregistrable ; export CSV de l’historique.',
      'Ensembles de symboles dans l’Observation du marché (clic droit → Ensembles).',
    ],
  },
  {
    titre: 'Sur téléphone',
    points: [
      'Interface façon MT5 mobile, installable sur l’écran d’accueil. Appui long sur une cotation, une position ou le graphique pour les actions.',
      'Glissez une position vers la gauche pour la fermer ; touchez un triangle du calendrier pour son détail.',
    ],
  },
];

export function DialogueGuide({ raccourcis }: { raccourcis: [string, string][] }) {
  const { fermer } = useTerminal();
  const [recherche, setRecherche] = useState('');
  const [onglet, setOnglet] = useState<'guide' | 'raccourcis'>('guide');
  const q = recherche.trim().toLowerCase();
  const sections = SECTIONS.map((s) => ({ ...s, points: s.points.filter((p) => !q || p.toLowerCase().includes(q) || s.titre.toLowerCase().includes(q)) })).filter((s) => s.points.length);
  return (
    <Fenetre titre="Aide — Parnassa Trader" fermer={fermer} largeur={620} className="fenetre-guide">
      <div className="guide-tete">
        <button className={onglet === 'guide' ? 'actif' : ''} onClick={() => setOnglet('guide')}>
          Guide
        </button>
        <button className={onglet === 'raccourcis' ? 'actif' : ''} onClick={() => setOnglet('raccourcis')}>
          Raccourcis clavier
        </button>
        {onglet === 'guide' && <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher (ex. stop suiveur, Heikin, risque)" autoFocus />}
      </div>
      <div className="guide-corps">
        {onglet === 'guide' ? (
          sections.length ? (
            sections.map((s) => (
              <section key={s.titre}>
                <h4>{s.titre}</h4>
                <ul>
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="aide">Aucun résultat pour « {recherche} ».</p>
          )
        ) : (
          <table className="table specification">
            <tbody>
              {raccourcis.map(([a, b]) => (
                <tr key={a}>
                  <td>
                    <kbd>{a}</kbd>
                  </td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    </Fenetre>
  );
}
