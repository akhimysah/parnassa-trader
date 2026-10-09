import { useRef } from 'react';
import { useTerminal, type Survol } from '../contexte';
import { dateMT } from './ui';

/**
 * Fenêtre de données de MT5 (Ctrl+D) : prix de la barre sous le réticule et valeurs de chaque indicateur.
 * Elle garde la dernière barre survolée quand la souris quitte le graphique.
 */
export function FenetreDonnees() {
  const { survolActuel, maj } = useTerminal();
  const dernier = useRef<Survol | null>(null);
  if (survolActuel) dernier.current = survolActuel;
  const d = dernier.current;
  // Grandes valeurs (ADX, RSI, OBV…) en deux décimales ou en entier ; petites (prix, écarts) au chiffre du symbole.
  const fmt = (v: number | null, chiffres: number) => (v === null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e6 ? Math.round(v).toLocaleString('fr-FR') : v.toFixed(Math.abs(v) >= 10 ? 2 : chiffres));
  return (
    <div className="panneau donnees">
      <div className="panneau-titre">
        <span>Fenêtre de données</span>
        <button onClick={() => maj((e) => ({ ...e, panneaux: { ...e.panneaux, donnees: false } }))} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="panneau-corps">
        {!d ? (
          <p className="vide-boite">Survolez un graphique.</p>
        ) : (
          <table className="table-donnees">
            <tbody>
              <tr className="entete-donnees">
                <td colSpan={2}>
                  {d.symbole},{d.periode}
                </td>
              </tr>
              <tr>
                <td>Date</td>
                <td>{dateMT(d.temps).slice(0, 10)}</td>
              </tr>
              <tr>
                <td>Heure</td>
                <td>{dateMT(d.temps).slice(11, 16)}</td>
              </tr>
              {(
                [
                  ['Ouverture', d.o],
                  ['Plus haut', d.h],
                  ['Plus bas', d.l],
                  ['Clôture', d.c],
                ] as const
              ).map(([nom, v]) => (
                <tr key={nom}>
                  <td>{nom}</td>
                  <td>{v.toFixed(d.chiffres)}</td>
                </tr>
              ))}
              <tr>
                <td>Volume</td>
                <td>{d.v ? Math.round(d.v).toLocaleString('fr-FR') : '—'}</td>
              </tr>
              {d.indicateurs?.map((ind, i) => [
                <tr key={`t${i}`} className="entete-donnees">
                  <td colSpan={2}>{ind.nom}</td>
                </tr>,
                ...ind.lignes.map((l, j) => (
                  <tr key={`${i}-${j}`}>
                    <td>
                      <span className="pastille-couleur" style={{ background: l.couleur }} />
                      {l.nom}
                    </td>
                    <td>{fmt(l.valeur, d.chiffres)}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
