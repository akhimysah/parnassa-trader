import { useEffect, useMemo, useState } from 'react';
import { useTerminal } from '../contexte';
import { tousExperts, definitionExpert, type TypeExpert } from '../algo/experts';
import { profitPosition } from '../compte/moteur';
import { calculerStats } from '../algo/statistiques';
import { CourbeSolde } from './Courbe';
import { preparerTest } from './Testeur';
import { Fenetre, Spin, argent } from './ui';

/** Attacher un Expert Advisor au graphique et régler ses paramètres (onglet « Entrées » de MT5). */
export function DialogueExpert({ graphique, expert }: { graphique: string; expert?: TypeExpert }) {
  const { etat, maj, majGraphique, fermer, compte, cotations, ouvrir } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  const [type, setType] = useState<TypeExpert>(expert ?? g?.expert?.type ?? 'croisement-ma');
  const def = definitionExpert(type);
  const [p, setP] = useState<Record<string, number>>(g?.expert?.type === type ? g.expert.p : def.defaut);
  useEffect(() => {
    setP(g?.expert?.type === type ? g.expert.p : definitionExpert(type).defaut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
  if (!g) {
    return (
      <Fenetre titre="Expert Advisor" fermer={fermer}>
        <p>Ouvrez d'abord un graphique.</p>
      </Fenetre>
    );
  }
  const actuel = g.expert;
  const ouvertes = actuel ? compte.positions.filter((x) => x.magic === actuel.magic) : [];
  const flottant = ouvertes.reduce((s, x) => s + profitPosition(x, cotations), 0);
  const pas = (k: string) => (k === 'volume' ? 0.01 : k === 'sl' || k === 'tp' ? 10 : 1);
  return (
    <Fenetre titre={`Expert Advisor — ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={480}>
      <div className="formulaire">
        <label>
          <span>Expert :</span>
          <select value={type} onChange={(e) => setType(e.target.value as TypeExpert)}>
            {tousExperts().map((x) => (
              <option key={x.type} value={x.type}>
                {x.nom}
              </option>
            ))}
          </select>
        </label>
        <p className="aide">
          {def.description}{' '}
          {type.startsWith('perso:') && (
            <button className="lien" onClick={() => ouvrir({ type: 'assistant', id: type.slice(6) })}>
              Modifier dans l'assistant
            </button>
          )}
        </p>
        <fieldset>
          <legend>Entrées</legend>
          {Object.keys(def.defaut).map((k) => (
            <label key={k}>
              <span>{def.libelles[k]} :</span>
              <Spin valeur={p[k] ?? def.defaut[k]} changer={(v) => setP({ ...p, [k]: v })} pas={pas(k)} min={k === 'volume' ? 0.01 : 0} decimales={k === 'volume' ? 2 : 0} />
            </label>
          ))}
        </fieldset>
        <label className="case">
          <input type="checkbox" checked={etat.algo} onChange={() => maj((e) => ({ ...e, algo: !e.algo }))} />
          Autoriser l'Algo Trading (tous les experts du terminal)
        </label>
        <p className="aide">
          L'expert décide à la clôture de chaque barre {g.periode} et ne trade que pendant que Parnassa Trader est ouvert. Il ne gère que ses propres positions (numéro magique{actuel ? ` ${actuel.magic}` : ''}).
        </p>
        {actuel && (
          <p>
            Positions de l'expert : <b>{ouvertes.length}</b>
            {ouvertes.length > 0 && (
              <>
                {' '}
                — profit flottant <b className={flottant >= 0 ? 'positif' : 'negatif'}>{argent(flottant)} USD</b>
              </>
            )}
          </p>
        )}
      </div>
      <div className="boutons">
        {actuel && (
          <button
            onClick={() => {
              majGraphique(g.id, { expert: null });
              fermer();
            }}
          >
            Retirer
          </button>
        )}
        <button
          onClick={() => {
            maj((e) => ({ ...e, panneaux: { ...e.panneaux, testeur: true } }));
            setTimeout(() => preparerTest({ expert: type, symbole: g.symbole, periode: g.periode, p }), 0);
            fermer();
          }}
        >
          Tester…
        </button>
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          onClick={() => {
            const magic = actuel?.type === type ? actuel.magic : 100000 + Math.floor(Math.random() * 900000);
            majGraphique(g.id, { expert: { type, p, magic } });
            fermer();
          }}
        >
          {actuel ? 'OK' : 'Attacher'}
        </button>
      </div>
    </Fenetre>
  );
}

// ---------- Rapport de trading ----------

export function DialogueRapport() {
  const { compte, fermer, cotations } = useTerminal();
  const s = useMemo(() => calculerStats(compte.transactions), [compte.transactions]);
  const flottant = compte.positions.reduce((t, p) => t + profitPosition(p, cotations), 0);
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)} %` : '—');
  const L = ({ l, v, c }: { l: string; v: string; c?: string }) => (
    <tr>
      <td>{l}</td>
      <td className={`d ${c ?? ''}`}>{v}</td>
    </tr>
  );
  const signe = (v: number) => (v > 0 ? 'positif' : v < 0 ? 'negatif' : '');
  return (
    <Fenetre titre={`Rapport de trading — ${compte.login} : ${compte.nom}`} fermer={fermer} largeur={860} className="fenetre-rapport">
      <div className="rapport-tete">
        <div>
          <small>Solde</small>
          <b>{argent(compte.solde)} USD</b>
        </div>
        <div>
          <small>Bénéfice net</small>
          <b className={signe(s.net)}>{argent(s.net)}</b>
        </div>
        <div>
          <small>Profit flottant</small>
          <b className={signe(flottant)}>{argent(flottant)}</b>
        </div>
        <div>
          <small>Facteur de profit</small>
          <b>{s.facteur === null ? '—' : s.facteur.toFixed(2)}</b>
        </div>
        <div>
          <small>Drawdown max.</small>
          <b className="negatif">{s.ddMaxPct.toFixed(2)} %</b>
        </div>
        <div>
          <small>Trades</small>
          <b>{s.trades}</b>
        </div>
      </div>
      <CourbeSolde points={s.courbe} />
      <div className="rapport-grille">
        <table className="table specification">
          <tbody>
            <L l="Dépôts" v={argent(s.depots)} />
            <L l="Retraits" v={argent(s.retraits)} />
            <L l="Profit brut" v={argent(s.brutGain)} c="positif" />
            <L l="Perte brute" v={argent(s.brutPerte)} c="negatif" />
            <L l="Bénéfice net" v={argent(s.net)} c={signe(s.net)} />
            <L l="Gain espéré par trade" v={argent(s.esperance)} c={signe(s.esperance)} />
            <L l="Ratio de Sharpe" v={s.sharpe === null ? '—' : s.sharpe.toFixed(2)} />
            <L l="Facteur de récupération" v={s.recouvrement === null ? '—' : s.recouvrement.toFixed(2)} />
            <L l="Drawdown absolu du solde" v={argent(s.ddAbsolu)} />
            <L l="Drawdown maximal du solde" v={`${argent(s.ddMax)} (${s.ddMaxPct.toFixed(2)} %)`} />
          </tbody>
        </table>
        <table className="table specification">
          <tbody>
            <L l="Trades au total" v={String(s.trades)} />
            <L l="Positions longues (% gagnantes)" v={`${s.longs} (${pct(s.longsGagnants, s.longs)})`} />
            <L l="Positions courtes (% gagnantes)" v={`${s.courts} (${pct(s.courtsGagnants, s.courts)})`} />
            <L l="Trades gagnants (% du total)" v={`${s.gagnants} (${pct(s.gagnants, s.trades)})`} />
            <L l="Trades perdants (% du total)" v={`${s.trades - s.gagnants} (${pct(s.trades - s.gagnants, s.trades)})`} />
            <L l="Plus gros gain" v={argent(s.plusGrosGain)} c="positif" />
            <L l="Plus grosse perte" v={argent(s.plusGrossePerte)} c="negatif" />
            <L l="Gain moyen / perte moyenne" v={`${argent(s.gainMoyen)} / ${argent(s.perteMoyenne)}`} />
            <L l="Gains consécutifs max." v={`${s.seriesGains.n} (${argent(s.seriesGains.montant)})`} />
            <L l="Pertes consécutives max." v={`${s.seriesPertes.n} (${argent(s.seriesPertes.montant)})`} />
          </tbody>
        </table>
      </div>
      {s.parSymbole.length > 0 && (
        <table className="table boite-table rapport-symboles">
          <thead>
            <tr>
              <th>Symbole</th>
              <th className="d">Trades</th>
              <th className="d">% gagnants</th>
              <th className="d">Bénéfice net</th>
            </tr>
          </thead>
          <tbody>
            {s.parSymbole.map((x) => (
              <tr key={x.symbole}>
                <td>{x.symbole}</td>
                <td className="d">{x.trades}</td>
                <td className="d">{pct(x.gagnants, x.trades)}</td>
                <td className={`d gras ${signe(x.net)}`}>{argent(x.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    </Fenetre>
  );
}
