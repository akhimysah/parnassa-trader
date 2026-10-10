import { useState } from 'react';
import { useTerminal } from '../contexte';
import { OPERATEURS, evaluateur, libelleOperande, type Condition, type Operateur } from '../algo/assistant';
import { calculer } from '../graphique/indicateurs';
import { calculerFormule } from '../graphique/formule';
import { chargerBougies, debutBougie, PERIODES, type Bougie, type Periode } from '../marche/bougies';
import { symbole } from '../marche/symboles';
import { EditeurOperande } from './Assistant';
import { Fenetre } from './ui';

interface Resultat {
  nom: string;
  vraie: boolean;
  a: number | null;
  b: number | null;
  erreur?: string;
}

/** Valeur de l'opérande à la dernière barre fermée (affichée dans le tableau). */
function valeurA(o: Condition['a'], b: Bougie[]): number | null {
  const i = b.length - 1;
  if (o.type === 'valeur') return o.valeur;
  if (o.type === 'prix') return b[i]?.[o.champ] ?? null;
  try {
    const v = o.type === 'formule' ? calculerFormule(o.formule, b)[0] : calculer({ id: '', type: o.indicateur, p: o.p, couleur: '', methode: o.methode }, b).traces[o.trace]?.valeurs;
    return v?.[i] ?? null;
  } catch {
    return null;
  }
}

/**
 * Scanner : la même condition que l'assistant (ex. RSI(14) est en dessous de 30) vérifiée sur tous les symboles de
 * l'Observation du marché, à la dernière barre fermée de la période choisie. Un clic ouvre le graphique.
 */
export function DialogueScanner() {
  const { etat, fermer, ouvrirGraphique } = useTerminal();
  const [periode, setPeriode] = useState<Periode>('H1');
  const [regle, setRegle] = useState<Condition>({ a: { type: 'indicateur', indicateur: 'rsi', p: { periode: 14 }, trace: 0 }, op: 'inferieur', b: { type: 'valeur', valeur: 30 } });
  const [resultats, setResultats] = useState<Resultat[] | null>(null);
  const [enCours, setEnCours] = useState<{ fait: number; total: number } | null>(null);
  const [tous, setTous] = useState(false);
  const lancer = async () => {
    const liste = etat.observation;
    setResultats([]);
    setEnCours({ fait: 0, total: liste.length });
    const sortie: Resultat[] = [];
    const enCoursBarre = debutBougie(Math.floor(Date.now() / 1000), periode);
    // Quatre symboles à la fois : assez rapide sans saturer le relais.
    for (let i = 0; i < liste.length; i += 4) {
      await Promise.all(
        liste.slice(i, i + 4).map(async (nom) => {
          const s = symbole(nom);
          if (!s) return;
          try {
            const b = (await chargerBougies(s, periode)).filter((x) => x.time < enCoursBarre);
            sortie.push({ nom, vraie: b.length > 2 && evaluateur(b)(regle), a: valeurA(regle.a, b), b: valeurA(regle.b, b) });
          } catch {
            sortie.push({ nom, vraie: false, a: null, b: null, erreur: 'historique indisponible' });
          }
        }),
      );
      setEnCours({ fait: Math.min(liste.length, i + 4), total: liste.length });
      setResultats([...sortie]);
    }
    setEnCours(null);
  };
  const affiches = (resultats ?? []).filter((r) => tous || r.vraie).sort((x, y) => Number(y.vraie) - Number(x.vraie) || x.nom.localeCompare(y.nom));
  const f = (v: number | null) => (v === null ? '—' : Math.abs(v) >= 1000 ? v.toFixed(2) : Math.abs(v) >= 10 ? v.toFixed(3) : v.toFixed(5));
  return (
    <Fenetre titre="Scanner de marché" fermer={fermer} largeur={720} className="fenetre-assistant">
      <div className="formulaire">
        <label>
          <span>Période :</span>
          <select value={periode} onChange={(e) => setPeriode(e.target.value as Periode)}>
            {PERIODES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.libelle}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="condition alerte-regle">
        <EditeurOperande o={regle.a} changer={(a) => setRegle({ ...regle, a })} />
        <select value={regle.op} onChange={(e) => setRegle({ ...regle, op: e.target.value as Operateur })}>
          {(Object.keys(OPERATEURS) as Operateur[]).map((op) => (
            <option key={op} value={op}>
              {OPERATEURS[op]}
            </option>
          ))}
        </select>
        <EditeurOperande o={regle.b} changer={(b) => setRegle({ ...regle, b })} />
      </div>
      <p className="aide">
        Vérifié sur les {etat.observation.length} symboles de l'Observation du marché, à la dernière barre {periode} fermée. « Croise » veut dire : sur cette barre précisément.
      </p>
      <div className="boutons gauche">
        <button className="principal" disabled={enCours !== null} onClick={() => void lancer()}>
          {enCours ? `Analyse ${enCours.fait} / ${enCours.total}…` : 'Lancer le scan'}
        </button>
        <label className="case">
          <input type="checkbox" checked={tous} onChange={() => setTous(!tous)} />
          Afficher aussi les symboles qui ne remplissent pas la condition
        </label>
      </div>
      {resultats && (
        <div className="scanner-resultats">
          <table className="table boite-table">
            <thead>
              <tr>
                <th>Symbole</th>
                <th>Condition</th>
                <th className="d">{libelleOperande(regle.a)}</th>
                <th className="d">{libelleOperande(regle.b)}</th>
              </tr>
            </thead>
            <tbody>
              {affiches.map((r) => (
                <tr
                  key={r.nom}
                  className={r.vraie ? '' : 'muet'}
                  title="Ouvrir le graphique"
                  onClick={() => {
                    ouvrirGraphique(r.nom, periode);
                    fermer();
                  }}
                >
                  <td>
                    <b>{r.nom}</b>
                  </td>
                  <td className={r.vraie ? 'positif' : ''}>{r.erreur ?? (r.vraie ? '✔ remplie' : 'non')}</td>
                  <td className="d">{f(r.a)}</td>
                  <td className="d">{f(r.b)}</td>
                </tr>
              ))}
              {!enCours && affiches.length === 0 && (
                <tr>
                  <td colSpan={4} className="muet">
                    Aucun symbole ne remplit la condition.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="boutons">
        <button onClick={fermer}>Fermer</button>
      </div>
    </Fenetre>
  );
}
