import { useEffect, useState } from 'react';
import { useTerminal, type Dialogue } from '../contexte';
import { identifiant, type Alerte, type Graphique, type Schema } from '../etat';
import { HEURE_ROLLOVER_UTC, SYMBOLES, TYPES_COMPTE, formaterPrix, jourSwapTriple, libelleSeances, point, spreadPoints, swapPoints, symbole, type Categorie } from '../marche/symboles';
import { abonnerProfondeur, type Carnet } from '../marche/binance';
import { sourceDirecte } from '../marche/cotations';
import { calculer, definition, DEFINITIONS, estSuperpose, nomCourt, type Indicateur, type MethodeMA, APPLICABLES, SOURCES, type Source } from '../graphique/indicateurs';
import { SCHEMAS } from '../graphique/couleurs';
import { definirSuiveur, fermerPosition, levierEffectif, operationBalance, ouvrirMarche, NIVEAU_APPEL_MARGE, NIVEAU_STOP_OUT, SERVEUR } from '../compte/moteur';
import { DialogueExpert, DialogueRapport } from './DialoguesAlgo';
import { BlocSynchro, DialogueSynchro } from './Synchro';
import { DialogueAcces, DialogueCompte, DialogueConnexion } from './DialoguesComptes';
import { DialogueAssistant } from './Assistant';
import { DialogueGuide } from './Guide';
import { DialogueScanner } from './Scanner';
import { DialogueModifierOrdre, DialogueModifierPosition, DialogueOrdre } from './DialogueOrdre';
import { Fenetre, Spin, argent, dateMT } from './ui';
import { OBJETS } from '../graphique/dessins';
import { depuisChampDate, versChampDate } from '../alertes';
import { EditeurOperande } from './Assistant';
import { OPERATEURS, type Condition, type Operateur } from '../algo/assistant';
import { PERIODES, type Periode } from '../marche/bougies';
import { perteJour, RISQUE_DEFAUT } from '../compte/risque';
import { erreurFormule, FONCTIONS } from '../graphique/formule';
import { DialogueMetaEditeur } from './MetaEditeur';
import { demanderPermission, notificationsDisponibles, testerPush } from '../notifications';

export function Dialogues() {
  const { dialogue } = useTerminal();
  if (!dialogue) return null;
  return <Contenu d={dialogue} />;
}

function Contenu({ d }: { d: Dialogue }) {
  const { etat } = useTerminal();
  switch (d.type) {
    case 'ordre':
      return <DialogueOrdre symboleInitial={d.symbole} sens={d.sens} attente={d.attente} prixInitial={d.prix} volumeInitial={d.volume} />;
    case 'modifier-position':
      return <DialogueModifierPosition ticket={d.ticket} />;
    case 'modifier-ordre':
      return <DialogueModifierOrdre ticket={d.ticket} />;
    case 'fermeture-partielle':
      return <DialogueFermeturePartielle ticket={d.ticket} />;
    case 'suiveur':
      return <DialogueSuiveur ticket={d.ticket} />;
    case 'specification':
      return <DialogueSpecification nom={d.symbole} />;
    case 'symboles':
      return <DialogueSymboles />;
    case 'compte':
      return <DialogueCompte />;
    case 'connexion':
      return <DialogueConnexion login={d.login} />;
    case 'depot':
      return <DialogueDepot />;
    case 'indicateur':
      return <DialogueIndicateur type={d.indicateur} graphique={d.graphique} existant={d.existant} />;
    case 'liste-indicateurs':
      return <DialogueListeIndicateurs graphique={d.graphique} />;
    case 'objets':
      return <DialogueObjets graphique={d.graphique} />;
    case 'objet':
      return <DialogueObjet graphique={d.graphique} id={d.id} />;
    case 'proprietes':
      return <DialogueProprietes graphique={d.graphique} />;
    case 'options':
      return <DialogueOptions />;
    case 'unclic':
      return <DialogueUnClic />;
    case 'alerte':
      return <DialogueAlerte id={d.id} symboleInitial={d.symbole} />;
    case 'profondeur':
      return <DialogueProfondeur nom={d.symbole} />;
    case 'resultat':
      return <DialogueResultat titre={d.titre} message={d.message} erreur={d.erreur} />;
    case 'apropos':
      return <DialogueAPropos />;
    case 'raccourcis':
      return <DialogueGuide raccourcis={RACCOURCIS as [string, string][]} />;
    case 'expert':
      return <DialogueExpert graphique={d.graphique} expert={d.expert} />;
    case 'rapport':
      return <DialogueRapport />;
    case 'synchro':
      return <DialogueSynchro />;
    case 'acces':
      return <DialogueAcces acces={d.acces} />;
    case 'assistant':
      // Un expert écrit en code s'ouvre dans le MetaEditor.
      return etat.expertsPerso.find((e) => e.id === d.id)?.script !== undefined ? <DialogueMetaEditeur id={d.id} /> : <DialogueAssistant id={d.id} />;
    case 'metaediteur':
      return <DialogueMetaEditeur id={d.id} />;
    case 'risque':
      return <DialogueRisque />;
    case 'scanner':
      return <DialogueScanner />;
  }
}

function DialogueResultat({ titre, message, erreur }: { titre: string; message: string; erreur: boolean }) {
  const { fermer } = useTerminal();
  return (
    <Fenetre titre={titre} fermer={fermer} largeur={400}>
      <div className={`resultat-ordre ${erreur ? 'ko' : 'ok'}`}>
        <div className="resultat-icone">{erreur ? '✖' : '✔'}</div>
        <div>{message}</div>
      </div>
      <div className="boutons">
        <button className="principal" onClick={fermer} autoFocus>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueFermeturePartielle({ ticket }: { ticket: number }) {
  const { compte, cotations, operer, fermer } = useTerminal();
  const p = compte.positions.find((x) => x.ticket === ticket);
  const [volume, setVolume] = useState(p ? Math.max(0.01, Number((p.volume / 2).toFixed(2))) : 0.01);
  if (!p) return null;
  const s = symbole(p.symbole)!;
  return (
    <Fenetre titre={`Fermeture partielle #${p.ticket}`} fermer={fermer} largeur={360}>
      <p>
        Position {p.type} {p.volume.toFixed(2)} {p.symbole}. Volume à fermer :
      </p>
      <Spin valeur={volume} changer={setVolume} pas={s.pasVolume} min={s.volumeMin} max={p.volume} decimales={2} />
      <div className="boutons">
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          onClick={() => {
            const r = operer((c) => fermerPosition(c, p.ticket, cotations, volume));
            if (!r.erreur) fermer();
          }}
        >
          Fermer {volume.toFixed(2)} lot
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueSuiveur({ ticket }: { ticket: number }) {
  const { compte, operer, fermer } = useTerminal();
  const p = compte.positions.find((x) => x.ticket === ticket);
  const [points, setPoints] = useState(p?.suiveur || 100);
  if (!p) return null;
  return (
    <Fenetre titre="Stop suiveur personnalisé" fermer={fermer} largeur={360}>
      <p>Distance du stop suiveur pour la position #{p.ticket} (en points) :</p>
      <Spin valeur={points} changer={setPoints} pas={5} min={5} decimales={0} />
      <p className="aide">Le stop-loss suit le prix dès que la position gagne plus que cette distance. Comme dans MT5, il est géré par le terminal : il ne fonctionne que lorsque l'application est ouverte.</p>
      <div className="boutons">
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          onClick={() => {
            operer((c) => ({ compte: definirSuiveur(c, p.ticket, points), erreur: null }), { silencieux: true });
            fermer();
          }}
        >
          OK
        </button>
      </div>
    </Fenetre>
  );
}

const NOMS_CATEGORIES: Record<Categorie, string> = { forex: 'Forex', metaux: 'Métaux', indices: 'Indices', energie: 'Énergie', 'actions-us': 'Actions États-Unis', 'actions-fr': 'Actions France', crypto: 'Crypto' };

function DialogueSpecification({ nom }: { nom: string }) {
  const { fermer, compte, cotations } = useTerminal();
  const s = symbole(nom)!;
  const q = cotations[nom];
  const sw = swapPoints(s, q ? (q.bid + q.ask) / 2 : 1);
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const triple = jourSwapTriple(s);
  const lignes: [string, string][] = [
    ['Symbole', s.nom],
    ['Description', s.description],
    ['Catégorie', `${NOMS_CATEGORIES[s.categorie]} (${s.chemin})`],
    ['Chiffres', String(s.chiffres)],
    ['Taille du point', point(s).toFixed(s.chiffres)],
    ['Type de compte', `${TYPES_COMPTE[compte.type ?? 'standard'].nom} — ${TYPES_COMPTE[compte.type ?? 'standard'].description}`],
    ['Spread', `${spreadPoints(s, compte.type ?? 'standard')} points en moyenne (Standard ${spreadPoints(s, 'standard')}, Raw ${spreadPoints(s, 'raw')})${s.direct.swissquote && sourceDirecte(nom) === 'swissquote' ? ', flottant au rythme de Swissquote' : ''}, élargi au rollover`],
    ['Commission', compte.type === 'raw' ? (s.categorie === 'forex' || s.categorie === 'metaux' ? '3,50 $ par lot et par côté (7 $ aller-retour)' : s.categorie === 'crypto' ? '0,025 % du montant par côté' : 'aucune') : 'aucune'],
    ['Taille du contrat', `${argent(s.contrat, 0)} ${s.base}`],
    ['Devise de marge', s.base.length === 3 && s.categorie === 'forex' ? s.base : 'USD'],
    ['Devise de profit', s.profit],
    ['Calcul', s.categorie === 'forex' ? 'Forex' : 'CFD'],
    ['Levier maximal', `1:${s.levierMax} (votre compte : 1:${levierEffectif(s, compte.levier)})`],
    ['Volume minimal', s.volumeMin.toFixed(2)],
    ['Volume maximal', s.volumeMax.toFixed(2)],
    ['Pas du volume', s.pasVolume.toFixed(2)],
    ['Niveau des stops', '0 point'],
    ['Exécution', 'Au marché'],
    ['Remplissage', 'Fill or Kill, Immediate or Cancel'],
    ['Expiration', 'GTC, aujourd\'hui, spécifiée'],
    ['Ordres', 'Market, Limit, Stop, Stop Limit, SL, TP'],
    ['Type de swap', compte.sansSwap ? 'aucun (compte sans swap)' : 'en points'],
    ['Swap long', compte.sansSwap ? '—' : `${sw.long.toFixed(2)} points par lot et par nuit`],
    ['Swap short', compte.sansSwap ? '—' : `${sw.short.toFixed(2)} points par lot et par nuit`],
    ['Swap triple', triple === null ? 'aucun (swap chaque jour, week-end compris)' : JOURS[triple]],
    ['Rollover', `${HEURE_ROLLOVER_UTC}:00 UTC (minuit serveur)`],
    ['Séances', libelleSeances(s)],
    ['Cotations', s.direct.swissquote ? `Swissquote ${s.direct.swissquote}, Bid/Ask réels chaque seconde${sourceDirecte(nom) === 'swissquote' ? '' : ' (indisponible : source de secours)'}` : s.direct.binance ? `Binance ${s.direct.binance} (temps réel)` : s.direct.yahoo ? 'Flux continu (≈ 1 mise à jour par seconde)' : s.direct.pilote ? `TradingView, animé par ${s.direct.pilote}` : 'TradingView (rafraîchi chaque seconde)'],
    ['Historique', s.histo.binance ? `Binance ${s.histo.binance}` : `Yahoo Finance ${s.histo.yahoo}${s.histo.recaler ? ' (contrat à terme recalé sur le comptant)' : ''}`],
  ];
  return (
    <Fenetre titre={`${s.nom}, spécification`} fermer={fermer} largeur={520}>
      <table className="table specification">
        <tbody>
          {lignes.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueSymboles() {
  const { etat, maj, fermer, ouvrir } = useTerminal();
  const [filtre, setFiltre] = useState('');
  const groupes = [...new Set(SYMBOLES.map((s) => s.chemin))];
  const visible = (n: string) => etat.observation.includes(n);
  const basculer = (n: string) => maj((e) => ({ ...e, observation: e.observation.includes(n) ? e.observation.filter((x) => x !== n) : [...e.observation, n] }));
  return (
    <Fenetre titre="Symboles" fermer={fermer} largeur={640}>
      <input className="recherche" placeholder="Rechercher un symbole" value={filtre} onChange={(e) => setFiltre(e.target.value)} autoFocus />
      <div className="symboles-liste">
        {groupes.map((gr) => {
          const liste = SYMBOLES.filter((s) => s.chemin === gr && (!filtre || `${s.nom} ${s.description}`.toLowerCase().includes(filtre.toLowerCase())));
          if (liste.length === 0) return null;
          return (
            <div key={gr}>
              <div className="symboles-groupe">📁 {gr}</div>
              {liste.map((s) => (
                <div key={s.nom} className="symboles-ligne" onDoubleClick={() => basculer(s.nom)}>
                  <input type="checkbox" checked={visible(s.nom)} onChange={() => basculer(s.nom)} />
                  <b>{s.nom}</b>
                  <span>{s.description}</span>
                  <button className="lien" onClick={() => ouvrir({ type: 'specification', symbole: s.nom })}>
                    Spécification
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="boutons">
        <button onClick={() => maj((e) => ({ ...e, observation: SYMBOLES.map((s) => s.nom) }))}>Tout afficher</button>
        <button className="principal" onClick={fermer}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueDepot() {
  const { operer, fermer, compte } = useTerminal();
  const [montant, setMontant] = useState(1000);
  return (
    <Fenetre titre={`Dépôt / retrait — ${compte.login}`} fermer={fermer} largeur={380}>
      <p>Solde actuel : {argent(compte.solde)} {compte.devise}</p>
      <Spin valeur={montant} changer={setMontant} pas={100} min={1} decimales={2} />
      <div className="boutons">
        <button
          onClick={() => {
            const r = operer((c) => operationBalance(c, -montant, 'Retrait de démonstration'), { silencieux: true });
            if (!r.erreur) fermer();
          }}
        >
          Retirer
        </button>
        <button
          className="principal"
          onClick={() => {
            operer((c) => operationBalance(c, montant, 'Dépôt de démonstration'), { silencieux: true });
            fermer();
          }}
        >
          Déposer
        </button>
      </div>
    </Fenetre>
  );
}

/** Propriétés d'un objet graphique : couleur, texte, points d'ancrage, comme la fenêtre de MT5. */
function DialogueObjet({ graphique, id }: { graphique: string; id: string }) {
  const { etat, majGraphique, fermer, ouvrir } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  const o = g?.objets.find((x) => x.id === id);
  const [couleur, setCouleur] = useState(o?.couleur ?? '#1e90ff');
  const [texte, setTexte] = useState(o?.texte ?? '');
  const [points, setPoints] = useState(o?.points ?? []);
  if (!g || !o) return null;
  const s = symbole(g.symbole)!;
  const valider = () => {
    majGraphique(g.id, (gr) => ({ objets: gr.objets.map((x) => (x.id === id ? { ...x, couleur, points, ...(x.type === 'texte' ? { texte: texte.trim().slice(0, 80) || x.texte } : {}) } : x)) }));
    fermer();
  };
  return (
    <Fenetre titre={`${OBJETS[o.type].nom} — propriétés`} fermer={fermer} largeur={400}>
      <div className="formulaire">
        {o.type === 'texte' && (
          <label>
            <span>Texte :</span>
            <input value={texte} maxLength={80} onChange={(e) => setTexte(e.target.value)} autoFocus />
          </label>
        )}
        <label>
          <span>Couleur :</span>
          <span className="palette">
            {COULEURS.map((c) => (
              <button key={c} type="button" className={c === couleur ? 'actif' : ''} style={{ background: c }} title={c} onClick={() => setCouleur(c)} />
            ))}
            <input type="color" value={couleur} onChange={(e) => setCouleur(e.target.value)} />
          </span>
        </label>
        {o.type !== 'verticale' &&
          points.map((p, i) => (
            <label key={i}>
              <span>{o.type === 'horizontale' ? 'Prix :' : `Point ${i + 1}, prix :`}</span>
              <Spin valeur={p.prix} changer={(v) => setPoints(points.map((x, k) => (k === i ? { ...x, prix: v } : x)))} pas={point(s)} decimales={s.chiffres} />
            </label>
          ))}
        {o.type !== 'horizontale' && <p className="aide">Dates : {points.map((p) => dateMT(p.t * 1000)).join(' → ')}. Tirez les poignées sur le graphique pour les changer.</p>}
      </div>
      <div className="boutons">
        <button
          onClick={() => {
            majGraphique(g.id, (gr) => ({ objets: gr.objets.filter((x) => x.id !== id) }));
            fermer();
          }}
        >
          Supprimer
        </button>
        <button onClick={() => ouvrir({ type: 'objets', graphique: g.id })}>Tous les objets…</button>
        <button className="principal" onClick={valider}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

const COULEURS = ['#ff3b30', '#1e90ff', '#20b2aa', '#ffa500', '#9932cc', '#32cd32', '#ff1493', '#808080', '#000000', '#ffd700'];

function DialogueIndicateur({ type, graphique, existant }: { type: Indicateur['type']; graphique: string; existant?: string }) {
  const { etat, majGraphique, fermer } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  const def = definition(type);
  const actuel = g?.indicateurs.find((i) => i.id === existant);
  const [p, setP] = useState<Record<string, number>>(actuel?.p ?? def.defaut);
  const [methode, setMethode] = useState<MethodeMA>(actuel?.methode ?? 'sma');
  const [couleur, setCouleur] = useState(actuel?.couleur ?? def.couleur);
  const [source, setSource] = useState<Source>(actuel?.source ?? 'close');
  const niveauxDefaut = calculer({ id: '', type, p: def.defaut, couleur: '' }, []).niveaux ?? [];
  const [niveaux, setNiveaux] = useState(((actuel?.niveaux ?? niveauxDefaut) as number[]).join(' ; '));
  const [epaisseur, setEpaisseur] = useState(actuel?.epaisseur ?? 1);
  const [formule, setFormule] = useState(actuel?.formule ?? 'ema(close, 20) - ema(close, 50)');
  const [surGraphique, setSurGraphique] = useState(actuel?.superposeFormule ?? false);
  const erreurF = type === 'formule' ? erreurFormule(formule) : null;
  if (!g) return null;
  const lireNiveaux = () =>
    niveaux
      .split(/[;\s]+/)
      .filter((x) => x.trim() !== '')
      .map((x) => Number(x.replace(',', '.')))
      .filter(Number.isFinite);
  // Position de l'indicateur dans la liste : « précédent » et « premier » n'ont de sens qu'après un autre indicateur.
  const position = actuel ? g.indicateurs.findIndex((i) => i.id === actuel.id) : g.indicateurs.length;
  const applicable = APPLICABLES.includes(type);
  const valider = () => {
    const liste = lireNiveaux();
    const ind: Indicateur = {
      id: actuel?.id ?? identifiant(),
      type,
      p,
      methode: type === 'ma' || type === 'env' ? methode : undefined,
      couleur,
      source: applicable && source !== 'close' ? source : undefined,
      niveaux: JSON.stringify(liste) === JSON.stringify(niveauxDefaut) ? undefined : liste,
      epaisseur: epaisseur > 1 ? epaisseur : undefined,
      ...(type === 'formule' ? { formule: formule.trim(), superposeFormule: surGraphique || undefined } : {}),
    };
    majGraphique(g.id, (gr) => ({ indicateurs: actuel ? gr.indicateurs.map((i) => (i.id === actuel.id ? ind : i)) : [...gr.indicateurs, ind] }));
    fermer();
  };
  return (
    <Fenetre titre={`${def.nom} — ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={400}>
      <div className="formulaire">
        {type === 'formule' && (
          <>
            <label>
              <span>Formule :</span>
              <textarea className="champ-formule" value={formule} onChange={(e) => setFormule(e.target.value)} rows={3} spellCheck={false} />
            </label>
            {erreurF ? <p className="erreur-champ">{erreurF}</p> : <p className="aide">Formule valide. Plusieurs courbes : séparez-les par « ; ».</p>}
            <label className="case">
              <input type="checkbox" checked={surGraphique} onChange={() => setSurGraphique(!surGraphique)} />
              Sur le graphique principal (formule en prix, ex. sma(close, 20) + 2 * atr(14))
            </label>
            <details className="aide-formule">
              <summary>Séries et fonctions</summary>
              <p>Séries : open, high, low, close, volume, median, typical. Opérations : + − × ÷ et parenthèses.</p>
              <ul>
                {Object.values(FONCTIONS).map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
              <p>Exemples : <code>(close - sma(close, 20)) / atr(14)</code> · <code>highest(high, 20) ; lowest(low, 20)</code> · <code>rsi(close, 14) - rsi(close, 28)</code></p>
            </details>
          </>
        )}
        {Object.keys(def.defaut).map((k) => (
          <label key={k}>
            <span>{def.libelles[k]} :</span>
            <Spin valeur={p[k]} changer={(v) => setP({ ...p, [k]: v })} pas={k === 'pas' || k === 'max' ? 0.01 : k === 'ecart' ? 0.05 : k === 'ecarts' ? 0.5 : 1} min={k === 'decalage' ? -100 : 0} decimales={k === 'pas' || k === 'max' || k === 'ecart' ? 2 : k === 'ecarts' ? 1 : 0} />
          </label>
        ))}
        {(type === 'ma' || type === 'env') && (
          <label>
            <span>Méthode :</span>
            <select value={methode} onChange={(e) => setMethode(e.target.value as MethodeMA)}>
              <option value="sma">Simple</option>
              <option value="ema">Exponentielle</option>
              <option value="smma">Lissée</option>
              <option value="lwma">Pondérée linéairement</option>
            </select>
          </label>
        )}
        {type !== 'ichimoku' && type !== 'env' && type !== 'macd' && type !== 'stoch' && (
          <label>
            <span>Couleur :</span>
            <span className="palette">
              {COULEURS.map((c) => (
                <button key={c} className={c === couleur ? 'actif' : ''} style={{ background: c }} onClick={() => setCouleur(c)} aria-label={c} />
              ))}
            </span>
          </label>
        )}
        {!def.superpose && !(type === 'formule' && surGraphique) && (
          <label>
            <span>Niveaux :</span>
            <input value={niveaux} onChange={(e) => setNiveaux(e.target.value)} placeholder="ex. 20 ; 50 ; 80" title="Lignes horizontales de la fenêtre de l'indicateur, séparées par des points-virgules" />
          </label>
        )}
        <label>
          <span>Épaisseur :</span>
          <select value={epaisseur} onChange={(e) => setEpaisseur(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        {applicable ? (
          <label>
            <span>Appliquer à :</span>
            <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
              {(Object.keys(SOURCES) as Source[])
                .filter((k) => position > 0 || (k !== 'precedent' && k !== 'premier'))
                .map((k) => (
                  <option key={k} value={k}>
                    {SOURCES[k]}
                    {k === 'precedent' && position > 0 ? ` (${nomCourt(g.indicateurs[position - 1])})` : k === 'premier' && position > 0 ? ` (${nomCourt(g.indicateurs[0])})` : ''}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <p className="aide">Appliqué aux prix (Bid).</p>
        )}
        {(source === 'precedent' || source === 'premier') && <p className="aide">Calculé sur la première courbe de cet indicateur et dessiné dans sa fenêtre (par exemple une moyenne mobile du RSI).</p>}
      </div>
      <div className="boutons">
        {actuel && (
          <button
            onClick={() => {
              majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.filter((i) => i.id !== actuel.id) }));
              fermer();
            }}
          >
            Supprimer
          </button>
        )}
        <button onClick={fermer}>Annuler</button>
        <button className="principal" onClick={valider} disabled={Boolean(erreurF)}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueListeIndicateurs({ graphique }: { graphique: string }) {
  const { etat, majGraphique, fermer, ouvrir } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  if (!g) return null;
  return (
    <Fenetre titre={`Indicateurs sur ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={420}>
      {g.indicateurs.length === 0 && <p className="aide">Aucun indicateur. Ajoutez-en depuis le Navigateur ou le menu Insertion.</p>}
      <ul className="liste-simple">
        {g.indicateurs.map((i) => (
          <li key={i.id}>
            <span style={{ color: i.couleur }}>■</span> {nomCourt(i)} <small>({estSuperpose(i) ? 'fenêtre principale' : 'sous-fenêtre'})</small>
            <span className="actions">
              <button onClick={() => ouvrir({ type: 'indicateur', indicateur: i.type, graphique: g.id, existant: i.id })}>Modifier</button>
              <button onClick={() => majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.filter((x) => x.id !== i.id) }))}>Supprimer</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="boutons">
        <select
          value=""
          onChange={(e) => e.target.value && ouvrir({ type: 'indicateur', indicateur: e.target.value as Indicateur['type'], graphique: g.id })}
        >
          <option value="">Ajouter un indicateur…</option>
          {DEFINITIONS.map((d) => (
            <option key={d.type} value={d.type}>
              {d.nom}
            </option>
          ))}
        </select>
        <button className="principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueObjets({ graphique }: { graphique: string }) {
  const { etat, majGraphique, fermer, ouvrir } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  if (!g) return null;
  const s = symbole(g.symbole);
  return (
    <Fenetre titre={`Objets sur ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={440}>
      {g.objets.length === 0 && <p className="aide">Aucun objet. Menu Insertion → Objets.</p>}
      <ul className="liste-simple">
        {g.objets.map((o) => (
          <li key={o.id}>
            <span style={{ color: o.couleur }}>■</span> {OBJETS[o.type].nom}{o.texte ? ` « ${o.texte} »` : ''} — {o.type === 'verticale' ? dateMT(o.points[0].t * 1000) : o.points.map((p) => formaterPrix(s, p.prix)).join(' → ')}
            <span className="actions">
              <button onClick={() => ouvrir({ type: 'objet', graphique: g.id, id: o.id })}>Propriétés</button>
              <button onClick={() => majGraphique(g.id, (gr) => ({ objets: gr.objets.filter((x) => x.id !== o.id) }))}>Supprimer</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="boutons">
        <button disabled={g.objets.length === 0} onClick={() => majGraphique(g.id, { objets: [] })}>
          Tout supprimer
        </button>
        <button className="principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueProprietes({ graphique }: { graphique: string }) {
  const { etat, majGraphique, fermer } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  if (!g) return null;
  const case_ = (cle: keyof Graphique, libelle: string) => (
    <label className="case">
      <input type="checkbox" checked={Boolean(g[cle])} onChange={() => majGraphique(g.id, { [cle]: !g[cle] } as Partial<Graphique>)} />
      {libelle}
    </label>
  );
  return (
    <Fenetre titre={`Propriétés — ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={460}>
      <fieldset>
        <legend>Couleurs</legend>
        <div className="schemas">
          {(Object.keys(SCHEMAS) as Schema[]).map((k) => (
            <button key={k} className={g.schema === k ? 'actif' : ''} onClick={() => majGraphique(g.id, { schema: k })}>
              <span className="apercu-schema" style={{ background: SCHEMAS[k].c.fond, borderColor: SCHEMAS[k].c.texte }}>
                <i style={{ background: SCHEMAS[k].c.corpsHausse, borderColor: SCHEMAS[k].c.hausse }} />
                <i style={{ background: SCHEMAS[k].c.corpsBaisse, borderColor: SCHEMAS[k].c.baisse }} />
              </span>
              {SCHEMAS[k].nom}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Affichage</legend>
        <label>
          Type :{' '}
          <select value={g.type} onChange={(e) => majGraphique(g.id, { type: e.target.value as Graphique['type'] })}>
            <option value="barres">Barres</option>
            <option value="bougies">Bougies japonaises</option>
            <option value="ligne">Ligne</option>
          </select>
        </label>
        {case_('grille', 'Afficher la grille')}
        {case_('ligneAsk', 'Afficher la ligne Ask')}
        {case_('niveauxTrading', 'Afficher les niveaux de trading (positions, ordres, SL / TP)')}
        {case_('historiqueTrading', "Afficher l'historique de trading (flèches)")}
        {case_('unClic', 'Afficher le panneau de trading en un clic')}
        {case_('defilement', 'Défilement automatique')}
        {case_('decalage', 'Décalage du graphique')}
      </fieldset>
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

/** Notifications du navigateur et push du serveur Parnassa-Trader, comme l'onglet Notifications des options de MT5. */
function BlocNotifications() {
  const { etat, maj, signaler } = useTerminal();
  if (!notificationsDisponibles()) return <p className="aide">Ce navigateur ne gère pas les notifications.</p>;
  const changer = async () => {
    if (etat.notifications) return maj((e) => ({ ...e, notifications: false }));
    if (await demanderPermission()) {
      maj((e) => ({ ...e, notifications: true }));
      signaler('Notifications activées : exécutions, SL/TP, stop-out et alertes, même terminal fermé');
    } else signaler('Notifications refusées par le navigateur : autorisez-les dans les réglages du site');
  };
  return (
    <>
      <label className="case">
        <input type="checkbox" checked={etat.notifications} onChange={() => void changer()} />
        Notifications (exécutions, SL/TP, stop-out, alertes)
      </label>
      <p className="aide">
        Pour les comptes en ligne, le serveur Parnassa-Trader exécute stop-loss, take-profit et ordres en attente même terminal fermé, et vous prévient par notification push. Les alertes Bid/Ask sont aussi surveillées par le serveur.
      </p>
      {etat.notifications && (
        <div className="boutons gauche">
          <button onClick={() => void testerPush().then(signaler)}>Tester la notification push</button>
        </div>
      )}
    </>
  );
}

function DialogueOptions() {
  const { etat, maj, fermer } = useTerminal();
  return (
    <Fenetre titre="Options" fermer={fermer} largeur={460}>
      <fieldset>
        <legend>Trading</legend>
        <label className="case">
          <input type="checkbox" checked={etat.unClicAccepte} onChange={() => maj((e) => ({ ...e, unClicAccepte: !e.unClicAccepte }))} />
          Trading en un clic (ordres envoyés sans confirmation)
        </label>
        <label>
          Volume par défaut :{' '}
          <Spin valeur={etat.volumeDefaut} changer={(v) => maj((e) => ({ ...e, volumeDefaut: v }))} pas={0.01} min={0.01} max={100} decimales={2} />
        </label>
      </fieldset>
      <BlocRisque />
      <fieldset>
        <legend>Interface</legend>
        <label>
          Thème :{' '}
          <select value={etat.theme} onChange={(e) => maj((x) => ({ ...x, theme: e.target.value as 'clair' | 'sombre' }))}>
            <option value="clair">Clair</option>
            <option value="sombre">Sombre</option>
          </select>
        </label>
        <label className="case">
          <input type="checkbox" checked={etat.son} onChange={() => maj((e) => ({ ...e, son: !e.son }))} />
          Sons (exécutions, alertes, stop-out)
        </label>
      </fieldset>
      <fieldset>
        <legend>Notifications</legend>
        <BlocNotifications />
      </fieldset>
      <fieldset>
        <legend>Compte Parnassa · synchronisation</legend>
        <BlocSynchro />
      </fieldset>
      <fieldset>
        <legend>Serveur</legend>
        <p className="aide">
          Serveur {SERVEUR}. Appel de marge à {NIVEAU_APPEL_MARGE} %, stop-out à {NIVEAU_STOP_OUT} %.
        </p>
      </fieldset>
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueUnClic() {
  const { maj, fermer } = useTerminal();
  const [accepte, setAccepte] = useState(false);
  return (
    <Fenetre titre="Trading en un clic" fermer={fermer} largeur={460}>
      <p>
        Le trading en un clic envoie vos ordres immédiatement, sans confirmation. En activant cette fonction, vous reconnaissez avoir compris que chaque clic sur SELL ou BUY ouvre une position au prix du marché.
      </p>
      <label className="case">
        <input type="checkbox" checked={accepte} onChange={() => setAccepte(!accepte)} />
        J'accepte ces conditions
      </label>
      <div className="boutons">
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          disabled={!accepte}
          onClick={() => {
            maj((e) => ({ ...e, unClicAccepte: true }));
            fermer();
          }}
        >
          OK
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueAlerte({ id, symboleInitial }: { id?: string; symboleInitial?: string }) {
  const { etat, maj, fermer, cotations } = useTerminal();
  const actuelle = etat.alertes.find((a) => a.id === id);
  const [sym, setSym] = useState(actuelle?.symbole ?? symboleInitial ?? etat.observation[0] ?? 'EURUSD');
  const [condition, setCondition] = useState<Alerte['condition']>(actuelle?.condition ?? 'bid>');
  const [valeur, setValeur] = useState(actuelle?.valeur ?? 0);
  const [commentaire, setCommentaire] = useState(actuelle?.commentaire ?? '');
  const [heure, setHeure] = useState(actuelle?.condition === 'heure=' ? actuelle.valeur : Date.now() + 3600_000);
  const [max, setMax] = useState(actuelle?.max ?? 1);
  const [pause, setPause] = useState(actuelle?.pause ?? 10);
  const [expiration, setExpiration] = useState<number | null>(actuelle?.expiration ?? null);
  const [regle, setRegle] = useState<Condition>(
    actuelle?.regle ?? { a: { type: 'indicateur', indicateur: 'rsi', p: { periode: 14 }, trace: 0 }, op: 'croise-dessus', b: { type: 'valeur', valeur: 30 } },
  );
  const [periodeAlerte, setPeriodeAlerte] = useState<Periode>(actuelle?.periode ?? (etat.graphiques.find((g) => g.id === etat.graphiqueActif)?.periode ?? 'H1'));
  const s = symbole(sym)!;
  const q = cotations[sym];
  useEffect(() => {
    if (valeur === 0 && q) setValeur(q.bid);
  }, [q, valeur]);
  return (
    <Fenetre titre={actuelle ? "Modifier l'alerte" : 'Créer une alerte'} fermer={fermer} largeur={420}>
      <div className="formulaire">
        <label>
          <span>Symbole :</span>
          <select value={sym} onChange={(e) => { setSym(e.target.value); setValeur(0); }}>
            {SYMBOLES.map((x) => (
              <option key={x.nom}>{x.nom}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Condition :</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value as Alerte['condition'])}>
            <option value="bid>">Bid &gt;</option>
            <option value="bid<">Bid &lt;</option>
            <option value="ask>">Ask &gt;</option>
            <option value="ask<">Ask &lt;</option>
            <option value="heure=">Heure =</option>
            <option value="indicateur">Indicateur</option>
          </select>
        </label>
        {condition === 'indicateur' ? (
          <>
            <label>
              <span>Période :</span>
              <select value={periodeAlerte} onChange={(e) => setPeriodeAlerte(e.target.value as Periode)}>
                {PERIODES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} — {p.libelle}
                  </option>
                ))}
              </select>
            </label>
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
            <label>
              <span>Déclenchements :</span>
              <Spin valeur={max} changer={(v) => setMax(Math.max(1, Math.round(v)))} pas={1} min={1} decimales={0} />
            </label>
            <p className="aide">Vérifiée à la clôture de chaque barre {periodeAlerte}, au plus une fois par barre (application ouverte).</p>
          </>
        ) : condition === 'heure=' ? (
          <label>
            <span>Heure :</span>
            <input type="datetime-local" value={versChampDate(heure)} onChange={(e) => setHeure(depuisChampDate(e.target.value))} />
          </label>
        ) : (
          <>
            <label>
              <span>Valeur :</span>
              <Spin valeur={valeur} changer={setValeur} pas={point(s)} decimales={s.chiffres} />
            </label>
            <label>
              <span>Déclenchements :</span>
              <Spin valeur={max} changer={(v) => setMax(Math.max(1, Math.round(v)))} pas={1} min={1} decimales={0} />
            </label>
            {max > 1 && (
              <label>
                <span>Pause (s) :</span>
                <Spin valeur={pause} changer={(v) => setPause(Math.max(1, Math.round(v)))} pas={5} min={1} decimales={0} />
              </label>
            )}
          </>
        )}
        <label className="case">
          <input type="checkbox" checked={expiration !== null} onChange={() => setExpiration(expiration === null ? Date.now() + 86400_000 : null)} />
          Expiration
        </label>
        {expiration !== null && (
          <label>
            <span>Expire le :</span>
            <input type="datetime-local" value={versChampDate(expiration)} onChange={(e) => setExpiration(depuisChampDate(e.target.value))} />
          </label>
        )}
        <label>
          <span>Commentaire :</span>
          <input value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={60} />
        </label>
        {q && (
          <p className="aide">
            Actuellement : Bid {formaterPrix(s, q.bid)} / Ask {formaterPrix(s, q.ask)}
          </p>
        )}
      </div>
      <div className="boutons">
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          onClick={() => {
            const a: Alerte = {
              id: actuelle?.id ?? identifiant(),
              symbole: sym,
              condition,
              valeur: condition === 'heure=' ? heure : valeur,
              commentaire,
              active: true,
              ...(condition === 'indicateur' ? { regle, periode: periodeAlerte, derniereBarre: undefined } : {}),
              max: condition === 'heure=' ? 1 : max,
              pause,
              declenchements: 0,
              expiration: expiration ?? undefined,
            };
            maj((e) => ({ ...e, alertes: actuelle ? e.alertes.map((x) => (x.id === a.id ? a : x)) : [...e.alertes, a] }));
            fermer();
          }}
        >
          OK
        </button>
      </div>
    </Fenetre>
  );
}

/** Profondeur du marché (DOM) : vrai carnet d'ordres Binance, 20 niveaux, avec achat/vente en un clic. */
function DialogueProfondeur({ nom }: { nom: string }) {
  const { fermer, cotations, operer, etat, ouvrir } = useTerminal();
  const s = symbole(nom)!;
  const [carnet, setCarnet] = useState<Carnet | null>(null);
  const [volume, setVolume] = useState(etat.volumeDefaut);
  useEffect(() => (s.direct.binance ? abonnerProfondeur(s.direct.binance, setCarnet) : undefined), [s]);
  const max = carnet ? Math.max(...carnet.bids.map((b) => b[1]), ...carnet.asks.map((a) => a[1])) : 1;
  const passer = (type: 'buy' | 'sell') => {
    if (!etat.unClicAccepte) return ouvrir({ type: 'unclic' });
    operer((c) => ouvrirMarche(c, { symbole: nom, type, volume, sl: 0, tp: 0, commentaire: '' }, cotations), { confirmation: false });
  };
  return (
    <Fenetre titre={`Profondeur du marché — ${nom}`} fermer={fermer} largeur={380} className="fenetre-dom">
      {!s.direct.binance ? (
        <p>La profondeur du marché n'est disponible que pour la crypto (carnet d'ordres Binance).</p>
      ) : !carnet ? (
        <p>Connexion au carnet d'ordres…</p>
      ) : (
        <>
          <div className="dom-actions">
            <button className="vente" onClick={() => passer('sell')}>
              Sell
            </button>
            <Spin valeur={volume} changer={setVolume} pas={s.pasVolume} min={s.volumeMin} max={s.volumeMax} decimales={2} />
            <button className="achat" onClick={() => passer('buy')}>
              Buy
            </button>
          </div>
          <table className="table dom">
            <tbody>
              {carnet.asks
                .slice(0, 12)
                .reverse()
                .map(([p, q]) => (
                  <tr key={`a${p}`} className="dom-ask">
                    <td className="d">
                      <span className="dom-barre" style={{ width: `${(q / max) * 100}%` }} />
                      {q.toFixed(4)}
                    </td>
                    <td className="d">{formaterPrix(s, p)}</td>
                    <td />
                  </tr>
                ))}
              {carnet.bids.slice(0, 12).map(([p, q]) => (
                <tr key={`b${p}`} className="dom-bid">
                  <td />
                  <td className="d">{formaterPrix(s, p)}</td>
                  <td>
                    <span className="dom-barre" style={{ width: `${(q / max) * 100}%` }} />
                    {q.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="aide">Volumes en {s.base} (carnet Binance {s.direct.binance}).</p>
        </>
      )}
    </Fenetre>
  );
}

function DialogueAPropos() {
  const { fermer } = useTerminal();
  return (
    <Fenetre titre="À propos de Parnassa Trader" fermer={fermer} largeur={460}>
      <div className="apropos">
        <img src={`${import.meta.env.BASE_URL}icone.svg`} alt="" width={56} height={56} />
        <div>
          <h2>Parnassa Trader</h2>
          <p>Terminal de trading multi-actifs inspiré de MetaTrader 5 : observation du marché, graphiques, ordres au marché et en attente, comptes de démonstration.</p>
          <p className="aide">
            Cotations : Binance (crypto, carnet réel), Yahoo Finance et TradingView (forex, métaux, indices, énergie, actions). Graphiques : bibliothèque Lightweight Charts™ de TradingView. Comptes de démonstration uniquement : aucun argent réel n'est engagé.
          </p>
        </div>
      </div>
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}

const RACCOURCIS: [string, string][] = [
  ['F4', 'MetaEditor (experts MQL Parnassa)'],
  ['F7', 'Compiler (dans le MetaEditor)'],
  ['F9', 'Nouvel ordre'],
  ['F8', 'Propriétés du graphique'],
  ['F11', 'Plein écran'],
  ['Ctrl+M', 'Observation du marché'],
  ['Ctrl+N', 'Navigateur'],
  ['Ctrl+T', 'Boîte à outils'],
  ['Ctrl+U', 'Symboles'],
  ['Ctrl+O', 'Options'],
  ['Ctrl+G', 'Grille'],
  ['Ctrl+L', 'Volumes'],
  ['Ctrl+I', 'Liste des indicateurs'],
  ['Ctrl+B', 'Liste des objets'],
  ['Ctrl+D', 'Fenêtre de données'],
  ['Ctrl+Z / Ctrl+Maj+Z', 'Annuler / rétablir le dernier changement des objets ou indicateurs du graphique'],
  ['Ctrl+Y', 'Séparateurs de périodes'],
  ['Taper un symbole ou une période', 'Navigation rapide (ex. GBPUSD,H4 puis Entrée)'],
  ['Alt+1 / Alt+2 / Alt+3 / Alt+4', 'Barres / bougies / ligne / Heikin Ashi'],
  ['Alt+T', 'Trading en un clic sur le graphique'],
  ['Ctrl+E', 'Activer / désactiver l\'Algo Trading'],
  ['Ctrl+R', 'Testeur de stratégie'],
  ['Alt+B', 'Profondeur du marché'],
  ['+ / −', 'Zoom avant / arrière'],
  ['Fin', 'Aller à la dernière barre'],
  ['Échap', 'Annuler l\'outil de dessin, fermer une fenêtre'],
];


/** Garde-fous de risque : perte du jour, positions et volume maximaux (0 = sans limite). */
export function BlocRisque() {
  const { etat, maj, compte, cotations } = useTerminal();
  const r = etat.risque ?? RISQUE_DEFAUT;
  const changer = (patch: Partial<typeof r>) => maj((e) => ({ ...e, risque: { ...(e.risque ?? RISQUE_DEFAUT), ...patch } }));
  const p = perteJour(compte, cotations);
  return (
    <fieldset className="bloc-risque">
      <legend>Gestion du risque</legend>
      <label>
        Perte du jour maximale (% du solde, 0 = aucune) :{' '}
        <Spin valeur={r.perteJourPct} changer={(v) => changer({ perteJourPct: Math.max(0, v) })} pas={0.5} min={0} max={100} decimales={1} />
      </label>
      <label className="case">
        <input type="checkbox" checked={r.fermerAuSeuil} onChange={() => changer({ fermerAuSeuil: !r.fermerAuSeuil })} />
        Fermer toutes les positions quand elle est atteinte
      </label>
      <label>
        Positions et ordres ouverts au plus (0 = sans limite) :{' '}
        <Spin valeur={r.maxPositions} changer={(v) => changer({ maxPositions: Math.max(0, Math.round(v)) })} pas={1} min={0} decimales={0} />
      </label>
      <label>
        Volume par position au plus (lots, 0 = sans limite) :{' '}
        <Spin valeur={r.maxVolume} changer={(v) => changer({ maxVolume: Math.max(0, v) })} pas={0.1} min={0} decimales={2} />
      </label>
      <p className="aide">
        Aujourd'hui sur {compte.login} : {p.montant > 0 ? `perte de ${argent(p.montant)} ${compte.devise} (${p.pct.toFixed(2)} %)` : `gain de ${argent(-p.montant)} ${compte.devise}`} depuis un solde de départ de {argent(p.depart)} {compte.devise}
        {r.perteJourPct > 0 && p.pct >= r.perteJourPct ? ' — limite atteinte, nouveaux ordres bloqués.' : '.'}
      </p>
    </fieldset>
  );
}

function DialogueRisque() {
  const { fermer } = useTerminal();
  return (
    <Fenetre titre="Gestion du risque" fermer={fermer} largeur={460}>
      <BlocRisque />
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          OK
        </button>
      </div>
    </Fenetre>
  );
}
