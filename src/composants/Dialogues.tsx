import { useEffect, useState } from 'react';
import { useTerminal, type Dialogue } from '../contexte';
import { identifiant, type Alerte, type Graphique, type Schema } from '../etat';
import { SYMBOLES, formaterPrix, libelleSeances, point, symbole, type Categorie } from '../marche/symboles';
import { abonnerProfondeur, type Carnet } from '../marche/binance';
import { sourceDirecte } from '../marche/cotations';
import { definition, DEFINITIONS, nomCourt, type Indicateur, type MethodeMA } from '../graphique/indicateurs';
import { SCHEMAS } from '../graphique/couleurs';
import { definirSuiveur, fermerPosition, levierEffectif, nouveauCompte, operationBalance, ouvrirMarche, NIVEAU_APPEL_MARGE, NIVEAU_STOP_OUT, SERVEUR } from '../compte/moteur';
import { DialogueExpert, DialogueRapport } from './DialoguesAlgo';
import { BlocSynchro, DialogueSynchro } from './Synchro';
import { DialogueModifierOrdre, DialogueModifierPosition, DialogueOrdre } from './DialogueOrdre';
import { Fenetre, Spin, argent } from './ui';

export function Dialogues() {
  const { dialogue } = useTerminal();
  if (!dialogue) return null;
  return <Contenu d={dialogue} />;
}

function Contenu({ d }: { d: Dialogue }) {
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
      return <DialogueConnexion />;
    case 'depot':
      return <DialogueDepot />;
    case 'indicateur':
      return <DialogueIndicateur type={d.indicateur} graphique={d.graphique} existant={d.existant} />;
    case 'liste-indicateurs':
      return <DialogueListeIndicateurs graphique={d.graphique} />;
    case 'objets':
      return <DialogueObjets graphique={d.graphique} />;
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
      return <DialogueRaccourcis />;
    case 'expert':
      return <DialogueExpert graphique={d.graphique} expert={d.expert} />;
    case 'rapport':
      return <DialogueRapport />;
    case 'synchro':
      return <DialogueSynchro />;
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
  const { fermer, compte } = useTerminal();
  const s = symbole(nom)!;
  const lignes: [string, string][] = [
    ['Symbole', s.nom],
    ['Description', s.description],
    ['Catégorie', `${NOMS_CATEGORIES[s.categorie]} (${s.chemin})`],
    ['Chiffres', String(s.chiffres)],
    ['Taille du point', point(s).toFixed(s.chiffres)],
    ['Spread', s.direct.binance ? 'flottant (carnet Binance)' : s.direct.swissquote ? `flottant (Swissquote)${sourceDirecte(nom) === 'swissquote' ? '' : ` — secours : ${s.spread} points fixes`}` : `${s.spread} points (fixe)`],
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
    ['Swap', '0 (non facturé sur le compte démo)'],
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

function DialogueCompte() {
  const { maj, fermer, signaler } = useTerminal();
  const [nom, setNom] = useState('Compte démo');
  const [depot, setDepot] = useState(10000);
  const [levier, setLevier] = useState(100);
  return (
    <Fenetre titre="Ouvrir un compte de démonstration" fermer={fermer} largeur={440}>
      <p className="aide">Serveur : {SERVEUR} — compte de couverture en USD. Aucune donnée personnelle n'est demandée : le compte est conservé dans ce navigateur.</p>
      <div className="formulaire">
        <label>
          <span>Nom du compte :</span>
          <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={40} />
        </label>
        <label>
          <span>Dépôt :</span>
          <select value={depot} onChange={(e) => setDepot(Number(e.target.value))}>
            {[500, 1000, 3000, 5000, 10000, 25000, 50000, 100000, 500000, 1000000].map((v) => (
              <option key={v} value={v}>
                {argent(v, 0)} USD
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Levier :</span>
          <select value={levier} onChange={(e) => setLevier(Number(e.target.value))}>
            {[1, 2, 5, 10, 20, 30, 50, 100, 200, 300, 400, 500, 1000].map((v) => (
              <option key={v} value={v}>
                1:{v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="boutons">
        <button onClick={fermer}>Annuler</button>
        <button
          className="principal"
          onClick={() => {
            const c = nouveauCompte(nom.trim() || 'Compte démo', depot, levier);
            maj((e) => ({ ...e, comptes: [...e.comptes, c], actif: c.login }));
            signaler(`Compte ${c.login} ouvert sur ${SERVEUR}`);
            fermer();
          }}
        >
          Ouvrir
        </button>
      </div>
    </Fenetre>
  );
}

function DialogueConnexion() {
  const { etat, maj, fermer, ouvrir } = useTerminal();
  return (
    <Fenetre titre="Se connecter à un compte de trading" fermer={fermer} largeur={420}>
      <div className="liste-comptes">
        {etat.comptes.map((c) => (
          <button
            key={c.login}
            className={c.login === etat.actif ? 'actif' : ''}
            onClick={() => {
              maj((e) => ({ ...e, actif: c.login }));
              fermer();
            }}
          >
            <b>{c.login}</b> — {c.nom}
            <small>
              {c.serveur} · 1:{c.levier} · solde {argent(c.solde)} USD
            </small>
          </button>
        ))}
      </div>
      <div className="boutons">
        <button onClick={() => ouvrir({ type: 'compte' })}>Ouvrir un compte…</button>
        <button className="principal" onClick={fermer}>
          Fermer
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
      <p>Solde actuel : {argent(compte.solde)} USD</p>
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

const COULEURS = ['#ff3b30', '#1e90ff', '#20b2aa', '#ffa500', '#9932cc', '#32cd32', '#ff1493', '#808080', '#000000', '#ffd700'];

function DialogueIndicateur({ type, graphique, existant }: { type: Indicateur['type']; graphique: string; existant?: string }) {
  const { etat, majGraphique, fermer } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  const def = definition(type);
  const actuel = g?.indicateurs.find((i) => i.id === existant);
  const [p, setP] = useState<Record<string, number>>(actuel?.p ?? def.defaut);
  const [methode, setMethode] = useState<MethodeMA>(actuel?.methode ?? 'sma');
  const [couleur, setCouleur] = useState(actuel?.couleur ?? def.couleur);
  if (!g) return null;
  const valider = () => {
    const ind: Indicateur = { id: actuel?.id ?? identifiant(), type, p, methode: type === 'ma' || type === 'env' ? methode : undefined, couleur };
    majGraphique(g.id, (gr) => ({ indicateurs: actuel ? gr.indicateurs.map((i) => (i.id === actuel.id ? ind : i)) : [...gr.indicateurs, ind] }));
    fermer();
  };
  return (
    <Fenetre titre={`${def.nom} — ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={400}>
      <div className="formulaire">
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
        <p className="aide">Appliqué aux prix de clôture (Bid).</p>
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
        <button className="principal" onClick={valider}>
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
            <span style={{ color: i.couleur }}>■</span> {nomCourt(i)} <small>({definition(i.type).superpose ? 'fenêtre principale' : 'sous-fenêtre'})</small>
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
  const { etat, majGraphique, fermer } = useTerminal();
  const g = etat.graphiques.find((x) => x.id === graphique);
  if (!g) return null;
  const s = symbole(g.symbole);
  const noms = { horizontale: 'Ligne horizontale', tendance: 'Ligne de tendance', fibo: 'Retracement de Fibonacci' };
  return (
    <Fenetre titre={`Objets sur ${g.symbole}, ${g.periode}`} fermer={fermer} largeur={440}>
      {g.objets.length === 0 && <p className="aide">Aucun objet. Menu Insertion → Objets.</p>}
      <ul className="liste-simple">
        {g.objets.map((o) => (
          <li key={o.id}>
            <span style={{ color: o.couleur }}>■</span> {noms[o.type]} — {o.points.map((p) => formaterPrix(s, p.prix)).join(' → ')}
            <span className="actions">
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
  const s = symbole(sym)!;
  const q = cotations[sym];
  useEffect(() => {
    if (valeur === 0 && q) setValeur(q.bid);
  }, [q, valeur]);
  return (
    <Fenetre titre={actuelle ? "Modifier l'alerte" : 'Créer une alerte'} fermer={fermer} largeur={400}>
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
          </select>
        </label>
        <label>
          <span>Valeur :</span>
          <Spin valeur={valeur} changer={setValeur} pas={point(s)} decimales={s.chiffres} />
        </label>
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
            const a: Alerte = { id: actuelle?.id ?? identifiant(), symbole: sym, condition, valeur, commentaire, active: true };
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
  ['Alt+1 / Alt+2 / Alt+3', 'Barres / bougies / ligne'],
  ['Alt+T', 'Trading en un clic sur le graphique'],
  ['Ctrl+E', 'Activer / désactiver l\'Algo Trading'],
  ['Ctrl+R', 'Testeur de stratégie'],
  ['Alt+B', 'Profondeur du marché'],
  ['+ / −', 'Zoom avant / arrière'],
  ['Fin', 'Aller à la dernière barre'],
  ['Échap', 'Annuler l\'outil de dessin, fermer une fenêtre'],
];

function DialogueRaccourcis() {
  const { fermer } = useTerminal();
  return (
    <Fenetre titre="Raccourcis clavier" fermer={fermer} largeur={440}>
      <table className="table specification">
        <tbody>
          {RACCOURCIS.map(([a, b]) => (
            <tr key={a}>
              <td>
                <kbd>{a}</kbd>
              </td>
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
