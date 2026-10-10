import { useState } from 'react';
import { useTerminal } from '../contexte';
import { identifiant } from '../etat';
import { CHAMPS_PRIX, OPERATEURS, decrireExpert, nouvelExpertPerso, tracesIndicateur, type ChampPrix, type Condition, type ExpertPerso, type Operande, type Operateur } from '../algo/assistant';
import { DEFINITIONS, GROUPES, definition, type MethodeMA, type TypeIndicateur } from '../graphique/indicateurs';
import { preparerTest } from './Testeur';
import { Fenetre, Spin } from './ui';
import { erreurFormule } from '../graphique/formule';

/** Indicateurs utilisables dans une condition (les volumes bruts n'ont pas de sens ici). */
const INDICATEURS = DEFINITIONS.filter((d) => d.type !== 'volumes');

/** Choix d'une opérande : prix, indicateur (avec ses paramètres et sa ligne) ou valeur fixe. */
export function EditeurOperande({ o, changer }: { o: Operande; changer: (o: Operande) => void }) {
  const cle = o.type === 'prix' ? `prix:${o.champ}` : o.type === 'valeur' ? 'valeur' : o.type === 'formule' ? 'formule' : `ind:${o.indicateur}`;
  const choisir = (v: string) => {
    if (v === 'valeur') return changer({ type: 'valeur', valeur: 0 });
    if (v === 'formule') return changer({ type: 'formule', formule: 'ema(close, 20) - ema(close, 50)' });
    if (v.startsWith('prix:')) return changer({ type: 'prix', champ: v.slice(5) as ChampPrix });
    const t = v.slice(4) as TypeIndicateur;
    changer({ type: 'indicateur', indicateur: t, p: { ...definition(t).defaut }, trace: 0 });
  };
  const traces = o.type === 'indicateur' ? tracesIndicateur(o.indicateur, o.p) : [];
  return (
    <span className="operande">
      <select value={cle} onChange={(e) => choisir(e.target.value)}>
        <optgroup label="Prix">
          {(Object.keys(CHAMPS_PRIX) as ChampPrix[]).map((c) => (
            <option key={c} value={`prix:${c}`}>
              {CHAMPS_PRIX[c]}
            </option>
          ))}
        </optgroup>
        {GROUPES.map((gr) => (
          <optgroup key={gr} label={gr}>
            {INDICATEURS.filter((d) => d.groupe === gr).map((d) => (
              <option key={d.type} value={`ind:${d.type}`}>
                {d.nom}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="valeur">Valeur fixe</option>
        <option value="formule">Formule…</option>
      </select>
      {o.type === 'formule' && (
        <span className="operande-formule">
          <input value={o.formule} onChange={(e) => changer({ ...o, formule: e.target.value })} spellCheck={false} title="Formule : séries open, high, low, close… et fonctions sma, ema, rsi, atr…" />
          {erreurFormule(o.formule) && <small className="erreur-champ">{erreurFormule(o.formule)}</small>}
        </span>
      )}
      {o.type === 'valeur' && <Spin valeur={o.valeur} changer={(v) => changer({ ...o, valeur: v })} pas={1} decimales={5} />}
      {o.type === 'indicateur' &&
        Object.keys(definition(o.indicateur).defaut).map((k) => (
          <label key={k} className="operande-param" title={definition(o.indicateur).libelles[k]}>
            <small>{definition(o.indicateur).libelles[k]}</small>
            <Spin valeur={o.p[k] ?? definition(o.indicateur).defaut[k]} changer={(v) => changer({ ...o, p: { ...o.p, [k]: v } })} pas={Number.isInteger(definition(o.indicateur).defaut[k]) ? 1 : 0.01} min={0} decimales={Number.isInteger(definition(o.indicateur).defaut[k]) ? 0 : 2} />
          </label>
        ))}
      {o.type === 'indicateur' && (o.indicateur === 'ma' || o.indicateur === 'env' || o.indicateur === 'force') && (
        <select value={o.methode ?? 'sma'} onChange={(e) => changer({ ...o, methode: e.target.value as MethodeMA })} title="Méthode de la moyenne">
          <option value="sma">Simple</option>
          <option value="ema">Exponentielle</option>
          <option value="smma">Lissée</option>
          <option value="lwma">Pondérée</option>
        </select>
      )}
      {o.type === 'indicateur' && traces.length > 1 && (
        <select value={o.trace} onChange={(e) => changer({ ...o, trace: Number(e.target.value) })}>
          {traces.map((t, i) => (
            <option key={i} value={i}>
              {t}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

function BlocConditions({ titre, aide, conditions, changer }: { titre: string; aide: string; conditions: Condition[]; changer: (c: Condition[]) => void }) {
  const ajouter = () => changer([...conditions, conditions[conditions.length - 1] ? structuredClone(conditions[conditions.length - 1]) : { a: { type: 'prix', champ: 'close' }, op: 'superieur', b: { type: 'indicateur', indicateur: 'ma', p: { periode: 50, decalage: 0 }, trace: 0 } }]);
  return (
    <fieldset className="bloc-conditions">
      <legend>{titre}</legend>
      <p className="aide">{aide}</p>
      {conditions.map((c, i) => (
        <div key={i} className="condition">
          {i > 0 && <span className="et">et</span>}
          <EditeurOperande o={c.a} changer={(a) => changer(conditions.map((x, k) => (k === i ? { ...x, a } : x)))} />
          <select value={c.op} onChange={(e) => changer(conditions.map((x, k) => (k === i ? { ...x, op: e.target.value as Operateur } : x)))}>
            {(Object.keys(OPERATEURS) as Operateur[]).map((op) => (
              <option key={op} value={op}>
                {OPERATEURS[op]}
              </option>
            ))}
          </select>
          <EditeurOperande o={c.b} changer={(b) => changer(conditions.map((x, k) => (k === i ? { ...x, b } : x)))} />
          <button className="lien" title="Retirer la condition" onClick={() => changer(conditions.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button className="lien" onClick={ajouter}>
        + Ajouter une condition
      </button>
    </fieldset>
  );
}

/** Assistant MQL5 façon Parnassa : créer ou modifier un expert à partir de conditions, sans code. */
export function DialogueAssistant({ id }: { id?: string }) {
  const { etat, maj, fermer, ouvrir, signaler } = useTerminal();
  const existant = etat.expertsPerso.find((e) => e.id === id);
  const [e, setE] = useState<ExpertPerso>(() => (existant ? structuredClone(existant) : nouvelExpertPerso(identifiant())));
  const champ = <K extends keyof ExpertPerso>(k: K) => (v: ExpertPerso[K]) => setE((x) => ({ ...x, [k]: v }));
  const valide = e.nom.trim() && (e.achat.length || e.vente.length);
  const enregistrer = () => {
    const propre = { ...e, nom: e.nom.trim().slice(0, 40) };
    maj((x) => ({ ...x, expertsPerso: x.expertsPerso.some((k) => k.id === propre.id) ? x.expertsPerso.map((k) => (k.id === propre.id ? propre : k)) : [...x.expertsPerso, propre] }));
    signaler(`Expert « ${propre.nom} » enregistré`);
    return propre;
  };
  const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif);
  return (
    <Fenetre titre={existant ? `Assistant — ${existant.nom}` : "Assistant de création d'expert"} fermer={fermer} largeur={760} className="fenetre-assistant">
      <div className="formulaire">
        <label>
          <span>Nom de l'expert :</span>
          <input value={e.nom} maxLength={40} onChange={(ev) => champ('nom')(ev.target.value)} autoFocus />
        </label>
      </div>
      <div className="formulaire assistant-filtres">
        <label>
          <span>Sens :</span>
          <select value={e.sens ?? 'deux'} onChange={(ev) => setE((x) => ({ ...x, sens: ev.target.value as ExpertPerso['sens'] }))}>
            <option value="deux">Achats et ventes</option>
            <option value="achat">Achats seulement</option>
            <option value="vente">Ventes seulement</option>
          </select>
        </label>
        <label>
          <span>Heures d'entrée :</span>
          <span className="heures">
            de{' '}
            <select value={e.heures?.[0] ?? 0} onChange={(ev) => setE((x) => ({ ...x, heures: [Number(ev.target.value), x.heures?.[1] ?? 24] }))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>{' '}
            à{' '}
            <select value={e.heures?.[1] ?? 24} onChange={(ev) => setE((x) => ({ ...x, heures: [x.heures?.[0] ?? 0, Number(ev.target.value)] }))}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </span>
        </label>
        <label>
          <span>Jours :</span>
          <span className="jours">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((j, k) => (
              <label key={j} className="case">
                <input
                  type="checkbox"
                  checked={!e.jours?.length || e.jours.includes(k)}
                  onChange={() =>
                    setE((x) => {
                      const tous = x.jours?.length ? x.jours : [0, 1, 2, 3, 4, 5, 6];
                      const suite = tous.includes(k) ? tous.filter((v) => v !== k) : [...tous, k].sort();
                      return { ...x, jours: suite.length === 7 ? undefined : suite };
                    })
                  }
                />
                {j}
              </label>
            ))}
          </span>
        </label>
      </div>
      <div className="assistant-blocs">
        <BlocConditions titre="Signal d'achat" aide="Toutes les conditions vraies à la clôture d'une barre : l'expert ferme sa vente et achète." conditions={e.achat} changer={champ('achat')} />
        <BlocConditions titre="Signal de vente" aide="Toutes vraies : l'expert ferme son achat et vend." conditions={e.vente} changer={champ('vente')} />
        <BlocConditions titre="Sortie des achats (facultatif)" aide="Ferme l'achat sans se retourner. Sans condition, l'achat reste ouvert jusqu'au signal de vente, au SL ou au TP." conditions={e.sortieAchat} changer={champ('sortieAchat')} />
        <BlocConditions titre="Sortie des ventes (facultatif)" aide="Ferme la vente sans se retourner." conditions={e.sortieVente} changer={champ('sortieVente')} />
      </div>
      <p className="aide resume-expert">{decrireExpert(e)}</p>
      <p className="aide">Volume, Stop Loss et Take Profit se règlent au moment d'attacher l'expert au graphique ou dans le testeur.</p>
      <div className="boutons">
        {existant && (
          <button
            onClick={() => {
              if (!window.confirm(`Supprimer l'expert « ${existant.nom} » ? Les graphiques qui l'utilisent ne tradent plus.`)) return;
              maj((x) => ({ ...x, expertsPerso: x.expertsPerso.filter((k) => k.id !== existant.id) }));
              fermer();
            }}
          >
            Supprimer
          </button>
        )}
        <button
          disabled={!valide}
          onClick={() => {
            const p = enregistrer();
            maj((x) => ({ ...x, panneaux: { ...x.panneaux, testeur: true } }));
            setTimeout(() => preparerTest({ expert: `perso:${p.id}`, symbole: g?.symbole ?? 'EURUSD', periode: g?.periode ?? 'H1' }), 0);
            fermer();
          }}
        >
          Enregistrer et tester…
        </button>
        <button
          disabled={!valide || !g}
          onClick={() => {
            const p = enregistrer();
            ouvrir({ type: 'expert', graphique: etat.graphiqueActif, expert: `perso:${p.id}` });
          }}
        >
          Enregistrer et attacher…
        </button>
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          disabled={!valide}
          onClick={() => {
            enregistrer();
            fermer();
          }}
        >
          Enregistrer
        </button>
      </div>
    </Fenetre>
  );
}
