import { useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { SYMBOLES, TYPES_COMPTE, formaterPrix, jourSwapTriple, libelleSeances, marcheOuvert, point, spreadPoints, swapPoints, symbole, type Categorie } from '../marche/symboles';
import { levierEffectif } from '../compte/moteur';
import { PrixGros, argent, heureMT } from '../composants/ui';
import { BoutonIcone, BoutonRetour, EnTete, IconePlus, useAppuiLong, useNav, vibrer } from './commun';
import { useInstallation } from '../installation';

const CATEGORIES: { id: Categorie; nom: string }[] = [
  { id: 'forex', nom: 'Forex' },
  { id: 'metaux', nom: 'Métaux' },
  { id: 'indices', nom: 'Indices' },
  { id: 'energie', nom: 'Énergie' },
  { id: 'crypto', nom: 'Crypto' },
  { id: 'actions-us', nom: 'Actions États-Unis' },
  { id: 'actions-fr', nom: 'Actions France' },
];

/** Cotations : liste des symboles en mode avancé (prix, spread, plus haut / bas) ou simple, comme MT5 mobile. */
export function Cotations({ voirGraphique }: { voirGraphique: (s: string) => void }) {
  const { etat, maj } = useTerminal();
  const { pousser } = useNav();
  const avance = etat.mobileAvance;
  const basculer = () => maj((e) => ({ ...e, mobileAvance: !e.mobileAvance }));
  return (
    <div className="mm-ecran">
      <EnTete
        titre="Cotations"
        gauche={
          <BoutonIcone titre="Modifier la liste" onClick={() => pousser({ type: 'editer' })}>
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M4 15.5V16h.5L14 6.5 13.5 6zM12.5 4.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </BoutonIcone>
        }
        droite={
          <>
            <BoutonIcone titre={avance ? 'Mode simple' : 'Mode avancé'} onClick={basculer}>
              <svg viewBox="0 0 20 20" width="20" height="20">
                {avance ? <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.7" /> : <path d="M3 4h14M3 8h9M3 12h14M3 16h9" stroke="currentColor" strokeWidth="1.7" />}
              </svg>
            </BoutonIcone>
            <BoutonIcone titre="Ajouter un symbole" onClick={() => pousser({ type: 'ajouter' })}>
              <IconePlus />
            </BoutonIcone>
          </>
        }
      />
      <div className="mm-defile">
        <BanniereInstallation />
        <ul className={`mm-cotations ${avance ? 'avance' : 'simple'}`}>
          {etat.observation.map((nom) => (
            <LigneCotation key={nom} nom={nom} avance={avance} voirGraphique={voirGraphique} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function LigneCotation({ nom, avance, voirGraphique }: { nom: string; avance: boolean; voirGraphique: (s: string) => void }) {
  const { cotations } = useTerminal();
  const { pousser, feuille } = useNav();
  const s = symbole(nom)!;
  const c = cotations[nom];
  const variation = c ? ((c.bid - c.ouverture) / c.ouverture) * 100 : 0;
  const couleur = c?.sens === -1 ? 'baisse' : 'hausse';
  const menu = () =>
    feuille(`${nom} — ${s.description}`, [
      { libelle: 'Nouvel ordre', action: () => pousser({ type: 'ordre', symbole: nom }) },
      { libelle: 'Graphique', action: () => voirGraphique(nom) },
      { libelle: 'Propriétés', action: () => pousser({ type: 'symbole', symbole: nom }) },
      ...(s.direct.binance ? [{ libelle: 'Profondeur du marché', action: () => pousser({ type: 'profondeur', symbole: nom }) }] : []),
      { libelle: 'Alerte de prix', action: () => pousser({ type: 'alerte', symbole: nom }) },
    ]);
  const appui = useAppuiLong(menu, menu);
  return (
    <li {...appui}>
      <div className="mm-cot-gauche">
        {avance && (
          <span className={`mm-variation ${variation >= 0 ? 'positif' : 'negatif'}`}>
            {c ? `${variation >= 0 ? '+' : ''}${variation.toFixed(2)}%` : ''}
          </span>
        )}
        <b className="mm-cot-nom">{nom}</b>
        {avance ? (
          <small>
            {c ? heureMT(c.heure) : '—'} <span className="mm-spread">⇆ {c ? Math.round((c.ask - c.bid) / point(s)) : '—'}</span>
            {!marcheOuvert(s) && <span className="mm-ferme"> · fermé</span>}
          </small>
        ) : (
          <small>{s.description}</small>
        )}
      </div>
      <div className={`mm-cot-prix ${couleur}`}>
        <PrixGros s={s} prix={c?.bid} />
        {avance && <small>B : {c ? formaterPrix(s, c.bas) : '—'}</small>}
      </div>
      <div className={`mm-cot-prix ${couleur}`}>
        <PrixGros s={s} prix={c?.ask} />
        {avance && <small>H : {c ? formaterPrix(s, c.haut) : '—'}</small>}
      </div>
    </li>
  );
}

/** Ajouter un symbole : recherche ou parcours par catégorie. */
export function AjouterSymbole() {
  const { etat, maj } = useTerminal();
  const [recherche, setRecherche] = useState('');
  const [categorie, setCategorie] = useState<Categorie | null>(null);
  const ajouter = (nom: string) => {
    vibrer();
    maj((e) => ({ ...e, observation: e.observation.includes(nom) ? e.observation.filter((x) => x !== nom) : [...e.observation, nom] }));
  };
  const filtre = recherche.trim().toLowerCase();
  const liste = SYMBOLES.filter((s) => (filtre ? `${s.nom} ${s.description}`.toLowerCase().includes(filtre) : s.categorie === categorie));
  return (
    <div className="mm-ecran">
      <EnTete titre={categorie && !filtre ? CATEGORIES.find((c) => c.id === categorie)!.nom : 'Ajouter un symbole'} gauche={categorie && !filtre ? <button className="mm-bouton-entete" onClick={() => setCategorie(null)}>‹ Retour</button> : <BoutonRetour />} />
      <div className="mm-recherche">
        <input type="search" placeholder="Rechercher (EURUSD, or, Apple…)" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
      </div>
      <div className="mm-defile">
        {!filtre && !categorie ? (
          <ul className="mm-liste">
            {CATEGORIES.map((c) => (
              <li key={c.id} className="fleche" onClick={() => setCategorie(c.id)}>
                <span className="mm-dossier">📁</span>
                {c.nom}
                <small className="mm-compte">{SYMBOLES.filter((s) => s.categorie === c.id).length}</small>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mm-liste">
            {liste.map((s) => {
              const present = etat.observation.includes(s.nom);
              return (
                <li key={s.nom} onClick={() => ajouter(s.nom)}>
                  <span className={`mm-ajout-rond ${present ? 'present' : ''}`}>{present ? '✓' : '+'}</span>
                  <div className="mm-liste-texte">
                    <b>{s.nom}</b>
                    <small>{s.description}</small>
                  </div>
                </li>
              );
            })}
            {liste.length === 0 && <li className="mm-vide">Aucun symbole trouvé</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Modifier la liste : supprimer (⊖) et réordonner en glissant la poignée (≡). */
export function EditerCotations() {
  const { etat, maj } = useTerminal();
  const { retour } = useNav();
  const glisse = useRef<{ nom: string; y: number; index: number } | null>(null);
  const [actif, setActif] = useState<string | null>(null);
  const HAUTEUR = 52;
  return (
    <div className="mm-ecran">
      <EnTete titre="Modifier" gauche={<span />} droite={<button className="mm-bouton-entete gras" onClick={retour}>OK</button>} />
      <div className="mm-defile">
        <ul className="mm-liste mm-edition">
          {etat.observation.map((nom) => (
            <li key={nom} className={actif === nom ? 'glisse' : ''} style={{ height: HAUTEUR }}>
              <button
                className="mm-supprimer"
                aria-label={`Retirer ${nom}`}
                onClick={() => {
                  vibrer();
                  maj((e) => ({ ...e, observation: e.observation.filter((x) => x !== nom) }));
                }}
              >
                −
              </button>
              <div className="mm-liste-texte">
                <b>{nom}</b>
                <small>{symbole(nom)?.description}</small>
              </div>
              <span
                className="mm-poignee"
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  glisse.current = { nom, y: e.clientY, index: etat.observation.indexOf(nom) };
                  setActif(nom);
                }}
                onPointerMove={(e) => {
                  const g = glisse.current;
                  if (!g) return;
                  const cible = Math.max(0, Math.min(etat.observation.length - 1, g.index + Math.round((e.clientY - g.y) / HAUTEUR)));
                  const actuel = etat.observation.indexOf(g.nom);
                  if (cible === actuel) return;
                  vibrer(4);
                  maj((x) => {
                    const liste = x.observation.filter((k) => k !== g.nom);
                    liste.splice(cible, 0, g.nom);
                    return { ...x, observation: liste };
                  });
                }}
                onPointerUp={() => {
                  glisse.current = null;
                  setActif(null);
                }}
              >
                ≡
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Propriétés du symbole (spécification du contrat). */
export function ProprietesSymbole({ nom }: { nom: string }) {
  const { compte, cotations } = useTerminal();
  const { pousser } = useNav();
  const s = symbole(nom)!;
  const c = cotations[nom];
  const lignes: [string, string][] = [
    ['Description', s.description],
    ['Chiffres', String(s.chiffres)],
    ['Type de compte', TYPES_COMPTE[compte.type ?? 'standard'].nom],
    ['Spread moyen', `${spreadPoints(s, compte.type ?? 'standard')} points`],
    ['Commission', compte.type === 'raw' ? (s.categorie === 'forex' || s.categorie === 'metaux' ? '7 $ par lot aller-retour' : s.categorie === 'crypto' ? '0,025 % par côté' : 'aucune') : 'aucune'],
    ['Cotations', s.direct.swissquote ? 'Swissquote, chaque seconde' : s.direct.binance ? 'Binance, temps réel' : s.direct.yahoo ? 'Flux continu' : 'Rafraîchies chaque seconde'],
    ['Taille du contrat', `${argent(s.contrat, 0)} ${s.base}`],
    ['Devise de profit', s.profit],
    ['Levier', `1:${levierEffectif(s, compte.levier)}`],
    ['Swap long', compte.sansSwap ? 'aucun' : `${swapPoints(s, c ? (c.bid + c.ask) / 2 : 1).long.toFixed(2)} points`],
    ['Swap short', compte.sansSwap ? 'aucun' : `${swapPoints(s, c ? (c.bid + c.ask) / 2 : 1).short.toFixed(2)} points`],
    ['Swap triple', jourSwapTriple(s) === 3 ? 'mercredi' : jourSwapTriple(s) === 5 ? 'vendredi' : 'aucun (chaque jour)'],
    ['Volume minimal', s.volumeMin.toFixed(2)],
    ['Volume maximal', s.volumeMax.toFixed(2)],
    ['Pas du volume', s.pasVolume.toFixed(2)],
    ['Exécution', 'Au marché'],
    ['Séances', libelleSeances(s)],
  ];
  return (
    <div className="mm-ecran">
      <EnTete titre={nom} sousTitre={s.description} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        {c && (
          <div className="mm-carte-prix">
            <div className="baisse">
              <small>Bid</small>
              <PrixGros s={s} prix={c.bid} />
            </div>
            <div className="hausse">
              <small>Ask</small>
              <PrixGros s={s} prix={c.ask} />
            </div>
          </div>
        )}
        <dl className="mm-details">
          {lignes.map(([a, b]) => (
            <div key={a}>
              <dt>{a}</dt>
              <dd>{b}</dd>
            </div>
          ))}
        </dl>
        <div className="mm-boutons-bas statique">
          <button className="mm-bouton principal" onClick={() => pousser({ type: 'ordre', symbole: nom })}>
            Nouvel ordre
          </button>
        </div>
      </div>
    </div>
  );
}

const CLE_BANNIERE = 'parnassa-trader:banniere-installation';

/** Bannière discrète proposant l'installation sur l'écran d'accueil (une fois refusée, elle ne revient plus). */
function BanniereInstallation() {
  const { etat, installer } = useInstallation();
  const { feuille } = useNav();
  const [masquee, setMasquee] = useState(() => {
    try {
      return localStorage.getItem(CLE_BANNIERE) === '1';
    } catch {
      return false;
    }
  });
  if (masquee || (etat !== 'invite' && etat !== 'ios')) return null;
  const masquer = () => {
    setMasquee(true);
    try {
      localStorage.setItem(CLE_BANNIERE, '1');
    } catch {
      // stockage indisponible
    }
  };
  return (
    <div className="mm-banniere">
      <img src={`${import.meta.env.BASE_URL}icone-192.png`} alt="" width={36} height={36} />
      <div>
        <b>Parnassa Trader</b>
        <small>Installez l'application sur votre écran d'accueil</small>
      </div>
      <button
        onClick={() => (etat === 'invite' ? void installer().then((ok) => ok && masquer()) : feuille("Installer sur l'iPhone", [{ libelle: 'Touchez Partager ⬆︎ puis « Sur l’écran d’accueil »', action: masquer }]))}
      >
        Installer
      </button>
      <button className="fermer" onClick={masquer} aria-label="Masquer">
        ✕
      </button>
    </div>
  );
}
