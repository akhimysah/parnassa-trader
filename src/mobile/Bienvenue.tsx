import { useState } from 'react';
import { vibrer } from './commun';

const CLE = 'parnassa-trader:bienvenue-vue';

const PAGES = [
  {
    icone: '📈',
    titre: 'Bienvenue sur Parnassa Trader',
    texte: "Un terminal de trading façon MetaTrader 5, dans votre poche : cotations, graphiques, ordres, historique et experts.",
  },
  {
    icone: '⚡',
    titre: 'Des prix réels, en direct',
    texte: "Or, métaux et forex au prix de Swissquote, crypto au carnet Binance, indices et actions en continu. Les spreads, commissions et swaps suivent ceux des courtiers MT5.",
  },
  {
    icone: '🛡️',
    titre: 'Un compte de démonstration',
    texte: "Vous tradez avec 10 000 USD fictifs : aucun argent réel n'est engagé. Touchez un symbole pour passer un ordre, glissez une position vers la gauche pour la fermer.",
  },
];

export function bienvenueVue(): boolean {
  try {
    return localStorage.getItem(CLE) === '1';
  } catch {
    return true;
  }
}

/** Accueil au premier lancement, en trois pages. */
export function Bienvenue({ fermer }: { fermer: () => void }) {
  const [page, setPage] = useState(0);
  const [depart, setDepart] = useState<number | null>(null);
  const terminer = () => {
    try {
      localStorage.setItem(CLE, '1');
    } catch {
      // stockage indisponible : l'accueil reviendra au prochain lancement
    }
    vibrer(15);
    fermer();
  };
  const p = PAGES[page];
  const derniere = page === PAGES.length - 1;
  return (
    <div
      className="mm-bienvenue"
      onPointerDown={(e) => setDepart(e.clientX)}
      onPointerUp={(e) => {
        if (depart === null) return;
        const dx = e.clientX - depart;
        setDepart(null);
        if (dx < -50 && !derniere) setPage(page + 1);
        if (dx > 50 && page > 0) setPage(page - 1);
      }}
    >
      <button className="mm-bienvenue-passer" onClick={terminer}>
        Passer
      </button>
      <div className="mm-bienvenue-page" key={page}>
        <div className="mm-bienvenue-icone">{p.icone}</div>
        <h1>{p.titre}</h1>
        <p>{p.texte}</p>
      </div>
      <div className="mm-bienvenue-points">
        {PAGES.map((_, i) => (
          <i key={i} className={i === page ? 'actif' : ''} />
        ))}
      </div>
      <button className="mm-bouton principal mm-bienvenue-bouton" onClick={() => (derniere ? terminer() : setPage(page + 1))}>
        {derniere ? 'COMMENCER' : 'SUIVANT'}
      </button>
    </div>
  );
}
