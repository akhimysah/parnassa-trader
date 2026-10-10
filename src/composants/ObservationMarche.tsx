import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { SYMBOLES, formaterPrix, marcheOuvert, point, symbole } from '../marche/symboles';
import { historiqueTicks } from '../marche/cotations';
import { ouvrirMarche } from '../compte/moteur';
import { PrixGros, Spin, heureMT, useMenuContextuel, type ElementMenu } from './ui';
import { demanderNom } from '../modeles';

type Onglet = 'symboles' | 'details' | 'trading' | 'ticks';

/** Fenêtre « Observation du marché » (Ctrl+M) : cotations Bid/Ask en direct, comme dans MT5. */
export function ObservationMarche() {
  const { etat, maj, cotations, ouvrir, ouvrirGraphique, operer } = useTerminal();
  const [onglet, setOnglet] = useState<Onglet>('symboles');
  const [choisi, setChoisi] = useState(etat.observation[0] ?? 'EURUSD');
  const [ajout, setAjout] = useState('');
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const col = etat.colonnes;
  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const masquer = (nom: string) => maj((e) => ({ ...e, observation: e.observation.filter((x) => x !== nom) }));
  const menuSymbole = (ev: React.MouseEvent, nom: string) => {
    ev.preventDefault();
    setChoisi(nom);
    const s = symbole(nom)!;
    const basculer = (c: keyof typeof col) => maj((e) => ({ ...e, colonnes: { ...e.colonnes, [c]: !e.colonnes[c] } }));
    const elements: ElementMenu[] = [
      { libelle: 'Nouvel ordre', raccourci: 'F9', action: () => ouvrir({ type: 'ordre', symbole: nom }) },
      { libelle: 'Profondeur du marché', raccourci: 'Alt+B', desactive: !s.direct.binance, action: () => ouvrir({ type: 'profondeur', symbole: nom }) },
      { libelle: 'Fenêtre graphique', action: () => ouvrirGraphique(nom) },
      { libelle: 'Graphique des ticks', action: () => setOnglet('ticks') },
      { separateur: true },
      { libelle: 'Masquer', raccourci: 'Suppr', action: () => masquer(nom) },
      { libelle: 'Afficher tout', action: () => maj((e) => ({ ...e, observation: SYMBOLES.map((x) => x.nom) })) },
      { libelle: 'Symboles', raccourci: 'Ctrl+U', action: () => ouvrir({ type: 'symboles' }) },
      {
        libelle: 'Ensembles',
        sousMenu: [
          ...ENSEMBLES_FIXES.map(([n, f]) => ({ libelle: n, action: () => maj((e) => ({ ...e, observation: SYMBOLES.filter(f).map((x) => x.nom) })) })),
          ...(etat.ensembles.length ? [{ separateur: true } as ElementMenu] : []),
          ...etat.ensembles.map((x) => ({ libelle: x.nom, action: () => maj((e) => ({ ...e, observation: x.symboles.filter((n) => SYMBOLES.some((s) => s.nom === n)) })) })),
          { separateur: true },
          {
            libelle: 'Enregistrer sous…',
            action: () => {
              const n = demanderNom(`Nom de l'ensemble (${etat.observation.length} symboles)`, 'Mon ensemble');
              if (n) maj((e) => ({ ...e, ensembles: [...e.ensembles.filter((x) => x.nom !== n), { nom: n, symboles: [...e.observation] }].sort((a, b) => a.nom.localeCompare(b.nom)) }));
            },
          },
          {
            libelle: 'Supprimer',
            desactive: !etat.ensembles.length,
            sousMenu: etat.ensembles.map((x) => ({ libelle: x.nom, action: () => window.confirm(`Supprimer l'ensemble « ${x.nom} » ?`) && maj((e) => ({ ...e, ensembles: e.ensembles.filter((k) => k.nom !== x.nom) })) })),
          },
        ],
      },
      { libelle: 'Spécification', action: () => ouvrir({ type: 'specification', symbole: nom }) },
      { separateur: true },
      {
        libelle: 'Colonnes',
        sousMenu: [
          { libelle: 'Variation journalière', coche: col.variation, action: () => basculer('variation') },
          { libelle: 'Spread', coche: col.spread, action: () => basculer('spread') },
          { libelle: 'Plus haut', coche: col.haut, action: () => basculer('haut') },
          { libelle: 'Plus bas', coche: col.bas, action: () => basculer('bas') },
          { libelle: 'Heure', coche: col.heure, action: () => basculer('heure') },
        ],
      },
      { libelle: 'Alerte…', action: () => ouvrir({ type: 'alerte', symbole: nom }) },
    ];
    ouvrirMenu(ev.clientX, ev.clientY, elements);
  };

  const ajouter = () => {
    const nom = ajout.trim().toUpperCase();
    const s = SYMBOLES.find((x) => x.nom === nom || x.nom.startsWith(nom));
    if (s) maj((e) => ({ ...e, observation: e.observation.includes(s.nom) ? e.observation : [...e.observation, s.nom] }));
    setAjout('');
  };

  // Glisser-déposer pour réordonner les symboles.
  const glisse = useRef<string | null>(null);

  return (
    <div className="panneau observation">
      <div className="panneau-titre">
        <span>Observation du marché : {heureMT(Date.now())}</span>
        <button onClick={() => maj((e) => ({ ...e, panneaux: { ...e.panneaux, observation: false } }))} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="panneau-corps">
        {onglet === 'symboles' && (
          <table className="table om-table">
            <thead>
              <tr>
                <th>Symbole</th>
                <th className="d">Offre</th>
                <th className="d">Demande</th>
                {col.spread && <th className="d">Spread</th>}
                {col.haut && <th className="d">Haut</th>}
                {col.bas && <th className="d">Bas</th>}
                {col.heure && <th className="d">Heure</th>}
                {col.variation && <th className="d">Var. jour</th>}
              </tr>
            </thead>
            <tbody>
              {etat.observation.map((nom) => {
                const s = symbole(nom)!;
                const c = cotations[nom];
                const variation = c ? ((c.bid - c.ouverture) / c.ouverture) * 100 : 0;
                const sens = c?.sens ?? 0;
                return (
                  <tr
                    key={nom}
                    className={`${choisi === nom ? 'choisi' : ''} ${sens > 0 ? 'hausse' : sens < 0 ? 'baisse' : ''}`}
                    onClick={() => setChoisi(nom)}
                    onDoubleClick={() => ouvrir({ type: 'ordre', symbole: nom })}
                    onContextMenu={(ev) => menuSymbole(ev, nom)}
                    draggable
                    onDragStart={(ev) => {
                      glisse.current = nom;
                      ev.dataTransfer.setData('text/symbole', nom);
                    }}
                    onDragOver={(ev) => ev.preventDefault()}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      const de = glisse.current;
                      if (!de || de === nom) return;
                      maj((e) => {
                        const liste = e.observation.filter((x) => x !== de);
                        liste.splice(liste.indexOf(nom), 0, de);
                        return { ...e, observation: liste };
                      });
                    }}
                    title={s.description}
                  >
                    <td>
                      <span className={`om-fleche ${sens > 0 ? 'hausse' : sens < 0 ? 'baisse' : ''}`}>{sens < 0 ? '▼' : '▲'}</span> {nom}
                      {!marcheOuvert(s) && <span className="om-ferme" title="Marché fermé"> ⏸</span>}
                    </td>
                    <td className="d prix">{c ? formaterPrix(s, c.bid) : '—'}</td>
                    <td className="d prix">{c ? formaterPrix(s, c.ask) : '—'}</td>
                    {col.spread && <td className="d">{c ? Math.round((c.ask - c.bid) / point(s)) : ''}</td>}
                    {col.haut && <td className="d">{c ? formaterPrix(s, c.haut) : ''}</td>}
                    {col.bas && <td className="d">{c ? formaterPrix(s, c.bas) : ''}</td>}
                    {col.heure && <td className="d">{c ? heureMT(c.heure) : ''}</td>}
                    {col.variation && <td className={`d ${variation > 0 ? 'positif' : variation < 0 ? 'negatif' : ''}`}>{c ? `${variation.toFixed(2)}%` : ''}</td>}
                  </tr>
                );
              })}
              <tr className="om-ajout">
                <td colSpan={8}>
                  <input
                    list="liste-symboles"
                    placeholder="+ cliquez pour ajouter"
                    value={ajout}
                    onChange={(e) => setAjout(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && ajouter()}
                    onBlur={() => ajout && ajouter()}
                  />
                  <datalist id="liste-symboles">
                    {SYMBOLES.filter((x) => !etat.observation.includes(x.nom)).map((x) => (
                      <option key={x.nom} value={x.nom}>
                        {x.description}
                      </option>
                    ))}
                  </datalist>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {onglet === 'details' && (
          <div className="om-details">
            {etat.observation.map((nom) => {
              const s = symbole(nom)!;
              const c = cotations[nom];
              const variation = c ? ((c.bid - c.ouverture) / c.ouverture) * 100 : 0;
              return (
                <div key={nom} className="om-carte" onDoubleClick={() => ouvrir({ type: 'ordre', symbole: nom })} onContextMenu={(ev) => menuSymbole(ev, nom)}>
                  <div className="om-carte-tete">
                    <b>{nom}</b>
                    <span className={variation >= 0 ? 'positif' : 'negatif'}>{c ? `${variation >= 0 ? '+' : ''}${variation.toFixed(2)}%` : ''}</span>
                  </div>
                  <div className="om-carte-prix">
                    <div className={c?.sens === -1 ? 'baisse' : 'hausse'}>
                      <PrixGros s={s} prix={c?.bid} />
                    </div>
                    <div className={c?.sens === -1 ? 'baisse' : 'hausse'}>
                      <PrixGros s={s} prix={c?.ask} />
                    </div>
                  </div>
                  <div className="om-carte-pied">
                    <span>Bas : {c ? formaterPrix(s, c.bas) : '—'}</span>
                    <span>Spread : {c ? Math.round((c.ask - c.bid) / point(s)) : '—'}</span>
                    <span>Haut : {c ? formaterPrix(s, c.haut) : '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {onglet === 'trading' && (
          <div className="om-trading">
            {etat.observation.map((nom) => {
              const s = symbole(nom)!;
              const c = cotations[nom];
              const v = volumes[nom] ?? etat.volumeDefaut;
              const passer = (type: 'buy' | 'sell') => {
                if (!etat.unClicAccepte) return ouvrir({ type: 'unclic' });
                operer((cc) => ouvrirMarche(cc, { symbole: nom, type, volume: v, sl: 0, tp: 0, commentaire: '' }, cotations), { confirmation: false });
              };
              return (
                <div key={nom} className="om-tcarte">
                  <div className="om-tcarte-nom">{nom}</div>
                  <div className="un-clic compact">
                    <button className="uc-vente" onClick={() => passer('sell')}>
                      <span className="uc-libelle">SELL</span>
                      <PrixGros s={s} prix={c?.bid} />
                    </button>
                    <div className="uc-volume">
                      <Spin valeur={v} changer={(x) => setVolumes((m) => ({ ...m, [nom]: x }))} pas={s.pasVolume} min={s.volumeMin} max={s.volumeMax} decimales={2} />
                    </div>
                    <button className="uc-achat" onClick={() => passer('buy')}>
                      <span className="uc-libelle">BUY</span>
                      <PrixGros s={s} prix={c?.ask} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {onglet === 'ticks' && <GraphiqueTicks nom={choisi} changer={setChoisi} />}
      </div>
      <div className="onglets-bas">
        {(
          [
            ['symboles', 'Symboles'],
            ['details', 'Détails'],
            ['trading', 'Trading'],
            ['ticks', 'Ticks'],
          ] as [Onglet, string][]
        ).map(([id, l]) => (
          <button key={id} className={onglet === id ? 'actif' : ''} onClick={() => setOnglet(id)}>
            {l}
          </button>
        ))}
        <span className="om-compte">
          {etat.observation.length} / {SYMBOLES.length}
        </span>
      </div>
      {menu}
    </div>
  );
}

/** Graphique des ticks Bid (bleu) et Ask (rouge), dessiné sur un canevas. */
export interface NiveauTicks {
  prix: number;
  couleur: string;
  libelle: string;
}

export function GraphiqueTicks({ nom, changer, hauteur, niveaux = [] }: { nom: string; changer?: (n: string) => void; hauteur?: number; niveaux?: NiveauTicks[] }) {
  const { etat, cotations } = useTerminal();
  const ref = useRef<HTMLCanvasElement>(null);
  const s = symbole(nom);
  const c = cotations[nom];
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !s) return;
    const dpr = window.devicePixelRatio || 1;
    const l = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = l * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const sombre = etat.theme === 'sombre';
    g.fillStyle = sombre ? '#151924' : '#ffffff';
    g.fillRect(0, 0, l, h);
    const ticks = historiqueTicks(nom).slice(-200);
    if (ticks.length < 2) {
      g.fillStyle = '#888';
      g.font = '11px Tahoma, sans-serif';
      g.fillText('En attente de ticks…', 8, 18);
      return;
    }
    // Les niveaux (entrée, S/L, T/P) proches restent visibles : l'échelle s'élargit jusqu'à eux (dans une limite raisonnable).
    const minTicks = Math.min(...ticks.map((t) => t.bid));
    const maxTicks = Math.max(...ticks.map((t) => t.ask));
    const portee = Math.max(maxTicks - minTicks, point(s) * 20) * 15;
    const visibles = niveaux.filter((n) => n.prix > 0 && n.prix > minTicks - portee && n.prix < maxTicks + portee);
    const min = Math.min(minTicks, ...visibles.map((n) => n.prix));
    const max = Math.max(maxTicks, ...visibles.map((n) => n.prix));
    const marge = (max - min) * 0.1 || point(s) * 5;
    const bas = min - marge;
    const haut = max + marge;
    const droite = 62;
    const y = (p: number) => h - ((p - bas) / (haut - bas)) * h;
    const x = (i: number) => (i / (ticks.length - 1)) * (l - droite - 4) + 2;
    g.strokeStyle = sombre ? '#232836' : '#eeeeee';
    g.lineWidth = 1;
    g.font = '10px Tahoma, sans-serif';
    g.fillStyle = sombre ? '#8a93a6' : '#555';
    for (let k = 0; k <= 4; k++) {
      const p = bas + ((haut - bas) * k) / 4;
      g.beginPath();
      g.moveTo(0, y(p));
      g.lineTo(l - droite, y(p));
      g.stroke();
      g.fillText(formaterPrix(s, p), l - droite + 4, y(p) + 3);
    }
    const trace = (cle: 'bid' | 'ask', couleur: string) => {
      g.strokeStyle = couleur;
      g.beginPath();
      ticks.forEach((t, i) => (i === 0 ? g.moveTo(x(i), y(t[cle])) : g.lineTo(x(i), y(t[cle]))));
      g.stroke();
    };
    trace('ask', '#ff3b30');
    trace('bid', '#1e90ff');
    for (const n of visibles) {
      g.strokeStyle = n.couleur;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(0, y(n.prix));
      g.lineTo(l - droite, y(n.prix));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = n.couleur;
      g.font = 'bold 10px -apple-system, Tahoma, sans-serif';
      g.fillText(n.libelle, 4, y(n.prix) - 3);
    }
  });
  return (
    <div className="ticks">
      {changer && (
        <select value={nom} onChange={(e) => changer(e.target.value)}>
          {etat.observation.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      )}
      <canvas ref={ref} style={{ height: hauteur ?? 'calc(100% - 26px)' }} />
      {c && s && (
        <div className="ticks-legende">
          <span className="bid">Bid {formaterPrix(s, c.bid)}</span> <span className="ask">Ask {formaterPrix(s, c.ask)}</span>
        </div>
      )}
    </div>
  );
}

/** Ensembles prêts à l'emploi, par famille d'instruments. */
export const ENSEMBLES_FIXES: [string, (s: (typeof SYMBOLES)[number]) => boolean][] = [
  ['Forex', (s) => s.categorie === 'forex'],
  ['Métaux et énergie', (s) => s.categorie === 'metaux' || s.categorie === 'energie'],
  ['Indices', (s) => s.categorie === 'indices'],
  ['Actions', (s) => s.categorie === 'actions-us' || s.categorie === 'actions-fr'],
  ['Crypto', (s) => s.categorie === 'crypto'],
];
