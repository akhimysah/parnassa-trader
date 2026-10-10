import { useEffect, useMemo, useState } from 'react';
import { useTerminal } from '../contexte';
import { identifiant, type Alerte } from '../etat';
import { SYMBOLES, formaterPrix, point, symbole } from '../marche/symboles';
import { abonnerProfondeur, type Carnet } from '../marche/binance';
import { APPLICABLES, SOURCES, type Source, DEFINITIONS, GROUPES, definition, nomCourt, type Indicateur, type MethodeMA, type TypeIndicateur } from '../graphique/indicateurs';
import { tousExperts, definitionExpert, type TypeExpert } from '../algo/experts';
import { calculerStats } from '../algo/statistiques';
import { definirSuiveur, operationBalance, ouvrirMarche, profitPosition } from '../compte/moteur';
import { CourbeSolde } from '../composants/Courbe';
import { PrixGros, argent } from '../composants/ui';
import { BoutonIcone, BoutonRetour, ChampPas, ChampVolume, EnTete, Interrupteur, Segments, useNav, vibrer } from './commun';
import { enregistrerRapport, enteteCompte, rapportHtml } from '../algo/rapportHtml';
import { depuisChampDate, versChampDate } from '../alertes';

// ---------- Rapport de trading ----------

export function EcranRapport() {
  const { compte, cotations } = useTerminal();
  const s = useMemo(() => calculerStats(compte.transactions), [compte.transactions]);
  const flottant = compte.positions.reduce((t, p) => t + profitPosition(p, cotations) + p.swap, 0);
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)} %` : '—');
  const signe = (v: number) => (v > 0 ? 'positif' : v < 0 ? 'negatif' : '');
  const L = ({ l, v, c }: { l: string; v: string; c?: string }) => (
    <div>
      <dt>{l}</dt>
      <dd className={c}>{v}</dd>
    </div>
  );
  const { signaler } = useTerminal();
  const partager = async () => {
    const texte = [
      `Parnassa Trader — compte ${compte.login} (démo)`,
      `Solde : ${argent(compte.solde)} USD`,
      `Bénéfice net : ${argent(s.net)} USD sur ${s.trades} trades (${pct(s.gagnants, s.trades)} gagnants)`,
      `Facteur de profit : ${s.facteur === null ? '—' : s.facteur.toFixed(2)} · drawdown max ${s.ddMaxPct.toFixed(2)} %`,
      ...s.parSymbole.slice(0, 5).map((x) => `${x.symbole} : ${argent(x.net)} USD (${x.trades} trades)`),
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Rapport Parnassa Trader', text: texte });
      else {
        await navigator.clipboard.writeText(texte);
        signaler('Rapport copié dans le presse-papiers');
      }
    } catch {
      // partage annulé
    }
  };
  return (
    <div className="mm-ecran">
      <EnTete
        titre="Rapport"
        sousTitre={`${compte.login} · ${compte.nom}`}
        gauche={<BoutonRetour />}
        droite={
          <>
          <BoutonIcone titre="Rapport complet (HTML)" onClick={() => void enregistrerRapport(`Rapport-${compte.login}.html`, rapportHtml(enteteCompte(compte), compte.transactions))}>
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M5 2h7l4 4v12H5zM12 2v4h4M8 11h6M8 14h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </BoutonIcone>
          <BoutonIcone titre="Partager" onClick={() => void partager()}>
            <svg viewBox="0 0 20 20" width="20" height="20">
              <path d="M10 13V3M6.5 6.5L10 3l3.5 3.5M5 9H4v8h12V9h-1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BoutonIcone>
          </>
        }
      />
      <div className="mm-defile">
        <div className="mm-tuiles">
          <div>
            <small>Bénéfice net</small>
            <b className={signe(s.net)}>{argent(s.net)}</b>
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
            <small>Trades gagnants</small>
            <b>{pct(s.gagnants, s.trades)}</b>
          </div>
        </div>
        <div className="mm-courbe">
          <CourbeSolde points={s.courbe} hauteur={170} />
        </div>
        <div className="mm-section">Résultats</div>
        <dl className="mm-details">
          <L l="Solde" v={argent(compte.solde)} />
          <L l="Profit flottant" v={argent(flottant)} c={signe(flottant)} />
          <L l="Dépôts / retraits" v={`${argent(s.depots)} / ${argent(s.retraits)}`} />
          <L l="Profit brut" v={argent(s.brutGain)} c="positif" />
          <L l="Perte brute" v={argent(s.brutPerte)} c="negatif" />
          <L l="Gain espéré par trade" v={argent(s.esperance)} c={signe(s.esperance)} />
          <L l="Ratio de Sharpe" v={s.sharpe === null ? '—' : s.sharpe.toFixed(2)} />
          <L l="Facteur de récupération" v={s.recouvrement === null ? '—' : s.recouvrement.toFixed(2)} />
          <L l="Drawdown maximal" v={`${argent(s.ddMax)} (${s.ddMaxPct.toFixed(2)} %)`} c="negatif" />
        </dl>
        <div className="mm-section">Trades</div>
        <dl className="mm-details">
          <L l="Trades au total" v={String(s.trades)} />
          <L l="Longs (% gagnants)" v={`${s.longs} (${pct(s.longsGagnants, s.longs)})`} />
          <L l="Courts (% gagnants)" v={`${s.courts} (${pct(s.courtsGagnants, s.courts)})`} />
          <L l="Plus gros gain" v={argent(s.plusGrosGain)} c="positif" />
          <L l="Plus grosse perte" v={argent(s.plusGrossePerte)} c="negatif" />
          <L l="Gain moyen / perte moyenne" v={`${argent(s.gainMoyen)} / ${argent(s.perteMoyenne)}`} />
          <L l="Gains consécutifs max." v={`${s.seriesGains.n} (${argent(s.seriesGains.montant)})`} />
          <L l="Pertes consécutives max." v={`${s.seriesPertes.n} (${argent(s.seriesPertes.montant)})`} />
        </dl>
        {s.parSymbole.length > 0 && (
          <>
            <div className="mm-section">Par symbole</div>
            <ul className="mm-liste">
              {s.parSymbole.map((x) => (
                <li key={x.symbole}>
                  <div className="mm-liste-texte">
                    <b>{x.symbole}</b>
                    <small>
                      {x.trades} trades · {pct(x.gagnants, x.trades)} gagnants
                    </small>
                  </div>
                  <b className={signe(x.net)}>{argent(x.net)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Indicateurs du graphique ----------

export function EcranIndicateurs() {
  const { etat, majGraphique } = useTerminal();
  const { pousser } = useNav();
  const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif) ?? etat.graphiques[0];
  if (!g) return null;
  const groupes = GROUPES;
  return (
    <div className="mm-ecran">
      <EnTete titre="Indicateurs" sousTitre={`${g.symbole}, ${g.periode}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-section">Sur le graphique</div>
        <ul className="mm-liste">
          {g.indicateurs.map((i) => (
            <li key={i.id} className="fleche" onClick={() => pousser({ type: 'indicateur', indicateur: i.type, existant: i.id })}>
              <span className="mm-pastille-couleur" style={{ background: i.couleur }} />
              <div className="mm-liste-texte">
                <b>{nomCourt(i)}</b>
                <small>{definition(i.type).superpose ? 'Fenêtre principale' : 'Sous-fenêtre'}</small>
              </div>
              <button
                className="mm-supprimer-texte"
                onClick={(e) => {
                  e.stopPropagation();
                  vibrer();
                  majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.filter((x) => x.id !== i.id) }));
                }}
              >
                Retirer
              </button>
            </li>
          ))}
          {g.indicateurs.length === 0 && <li className="mm-vide">Aucun indicateur</li>}
        </ul>
        {groupes.map((gr) => (
          <div key={gr}>
            <div className="mm-section">{gr}</div>
            <ul className="mm-liste">
              {DEFINITIONS.filter((d) => d.groupe === gr).map((d) => (
                <li key={d.type} onClick={() => pousser({ type: 'indicateur', indicateur: d.type })}>
                  <span className="mm-ajout-rond">+</span>
                  <div className="mm-liste-texte">
                    <b>{d.nom}</b>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

const COULEURS = ['#ff3b30', '#007aff', '#20b2aa', '#ff9500', '#af52de', '#34c759', '#ff2d55', '#8e8e93', '#000000', '#ffcc00'];

export function EcranIndicateur({ type, existant }: { type: TypeIndicateur; existant?: string }) {
  const { etat, majGraphique } = useTerminal();
  const { retour } = useNav();
  const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif) ?? etat.graphiques[0];
  const def = definition(type);
  const actuel = g?.indicateurs.find((i) => i.id === existant);
  const [p, setP] = useState<Record<string, number>>(actuel?.p ?? def.defaut);
  const [methode, setMethode] = useState<MethodeMA>(actuel?.methode ?? 'sma');
  const [couleur, setCouleur] = useState(actuel?.couleur ?? def.couleur);
  const [source, setSource] = useState<Source>(actuel?.source ?? 'close');
  if (!g) return null;
  const position = actuel ? g.indicateurs.findIndex((i) => i.id === actuel.id) : g.indicateurs.length;
  const applicable = APPLICABLES.includes(type);
  const pas = (k: string) => (k === 'pas' || k === 'max' ? 0.01 : k === 'ecart' ? 0.05 : k === 'ecarts' ? 0.5 : 1);
  const dec = (k: string) => (k === 'pas' || k === 'max' || k === 'ecart' ? 2 : k === 'ecarts' ? 1 : 0);
  return (
    <div className="mm-ecran">
      <EnTete titre={def.nom} sousTitre={`${g.symbole}, ${g.periode}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          {Object.keys(def.defaut).map((k) => (
            <div key={k} className="mm-ligne-champ">
              <span>{def.libelles[k]}</span>
              <ChampPas valeur={p[k]} changer={(v) => setP({ ...p, [k]: v })} pas={pas(k)} min={k === 'decalage' ? -100 : 0} decimales={dec(k)} />
            </div>
          ))}
          {(type === 'ma' || type === 'env') && (
            <label className="mm-ligne-champ">
              <span>Méthode</span>
              <select value={methode} onChange={(e) => setMethode(e.target.value as MethodeMA)}>
                <option value="sma">Simple</option>
                <option value="ema">Exponentielle</option>
                <option value="smma">Lissée</option>
                <option value="lwma">Pondérée linéairement</option>
              </select>
            </label>
          )}
          {applicable && (
            <label className="mm-ligne-champ">
              <span>Appliquer à</span>
              <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
                {(Object.keys(SOURCES) as Source[])
                  .filter((k) => position > 0 || (k !== 'precedent' && k !== 'premier'))
                  .map((k) => (
                    <option key={k} value={k}>
                      {SOURCES[k]}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!['ichimoku', 'env', 'macd', 'stoch'].includes(type) && (
            <div className="mm-ligne-champ">
              <span>Couleur</span>
              <div className="mm-palette">
                {COULEURS.map((c) => (
                  <button key={c} className={c === couleur ? 'actif' : ''} style={{ background: c }} onClick={() => setCouleur(c)} aria-label={c} />
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="mm-note">{source === 'precedent' || source === 'premier' ? "Calculé sur la première courbe de l'indicateur choisi et dessiné dans sa fenêtre." : 'Calculé sur les prix (Bid) des bougies du graphique.'}</p>
      </div>
      <div className="mm-boutons-bas">
        {actuel && (
          <button
            className="mm-bouton vente"
            onClick={() => {
              majGraphique(g.id, (gr) => ({ indicateurs: gr.indicateurs.filter((i) => i.id !== actuel.id) }));
              retour();
            }}
          >
            RETIRER
          </button>
        )}
        <button
          className="mm-bouton principal"
          onClick={() => {
            const ind: Indicateur = { id: actuel?.id ?? identifiant(), type, p, methode: type === 'ma' || type === 'env' ? methode : undefined, couleur, source: applicable && source !== 'close' ? source : undefined };
            majGraphique(g.id, (gr) => ({ indicateurs: actuel ? gr.indicateurs.map((i) => (i.id === actuel.id ? ind : i)) : [...gr.indicateurs, ind] }));
            vibrer(15);
            retour();
          }}
        >
          {actuel ? 'ENREGISTRER' : 'AJOUTER'}
        </button>
      </div>
    </div>
  );
}

// ---------- Alertes ----------

export function EcranAlerte({ id, symboleInitial }: { id?: string; symboleInitial?: string }) {
  const { etat, maj, cotations } = useTerminal();
  const { retour } = useNav();
  const actuelle = etat.alertes.find((a) => a.id === id);
  const [sym, setSym] = useState(actuelle?.symbole ?? symboleInitial ?? etat.observation[0] ?? 'EURUSD');
  const [condition, setCondition] = useState<Alerte['condition']>(actuelle?.condition ?? 'bid>');
  const [valeur, setValeur] = useState(actuelle?.valeur ?? 0);
  const [commentaire, setCommentaire] = useState(actuelle?.commentaire ?? '');
  const [heure, setHeure] = useState(actuelle?.condition === 'heure=' ? actuelle.valeur : Date.now() + 3600_000);
  const [max, setMax] = useState(actuelle?.max ?? 1);
  const [expiration, setExpiration] = useState<number | null>(actuelle?.expiration ?? null);
  const s = symbole(sym)!;
  const q = cotations[sym];
  useEffect(() => {
    if (valeur === 0 && q) setValeur(q.bid);
  }, [q, valeur]);
  return (
    <div className="mm-ecran">
      <EnTete titre={actuelle ? "Modifier l'alerte" : 'Nouvelle alerte'} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <label className="mm-ligne-champ">
            <span>Symbole</span>
            <select value={sym} onChange={(e) => { setSym(e.target.value); setValeur(0); }}>
              {SYMBOLES.map((x) => (
                <option key={x.nom}>{x.nom}</option>
              ))}
            </select>
          </label>
          <label className="mm-ligne-champ">
            <span>Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value as Alerte['condition'])}>
              <option value="bid>">Bid supérieur à</option>
              <option value="bid<">Bid inférieur à</option>
              <option value="ask>">Ask supérieur à</option>
              <option value="ask<">Ask inférieur à</option>
              <option value="heure=">À une heure précise</option>
            </select>
          </label>
          {condition === 'heure=' ? (
            <label className="mm-ligne-champ">
              <span>Heure</span>
              <input type="datetime-local" value={versChampDate(heure)} onChange={(e) => setHeure(depuisChampDate(e.target.value))} />
            </label>
          ) : (
            <>
              <div className="mm-ligne-champ">
                <span>Valeur</span>
                <ChampPas valeur={valeur} changer={setValeur} pas={point(s)} decimales={s.chiffres} />
              </div>
              <div className="mm-ligne-champ">
                <span>Déclenchements</span>
                <ChampPas valeur={max} changer={(v) => setMax(Math.max(1, Math.round(v)))} pas={1} min={1} decimales={0} />
              </div>
            </>
          )}
          <div className="mm-ligne-champ">
            <span>Expiration</span>
            <span style={{ justifySelf: 'end' }}>
              <Interrupteur actif={expiration !== null} libelle="Expiration" changer={(v) => setExpiration(v ? Date.now() + 86400_000 : null)} />
            </span>
          </div>
          {expiration !== null && (
            <label className="mm-ligne-champ">
              <span>Expire le</span>
              <input type="datetime-local" value={versChampDate(expiration)} onChange={(e) => setExpiration(depuisChampDate(e.target.value))} />
            </label>
          )}
          <label className="mm-ligne-champ">
            <span>Commentaire</span>
            <input value={commentaire} maxLength={60} placeholder="facultatif" onChange={(e) => setCommentaire(e.target.value)} />
          </label>
        </div>
        {q && (
          <div className="mm-carte-prix">
            <div className="baisse">
              <small>Bid</small>
              <PrixGros s={s} prix={q.bid} />
            </div>
            <div className="hausse">
              <small>Ask</small>
              <PrixGros s={s} prix={q.ask} />
            </div>
          </div>
        )}
        <p className="mm-note">Activez les notifications dans Paramètres pour être prévenu même application fermée en arrière-plan.</p>
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton principal"
          onClick={() => {
            const a: Alerte = {
              id: actuelle?.id ?? identifiant(),
              symbole: sym,
              condition,
              valeur: condition === 'heure=' ? heure : valeur,
              commentaire,
              active: true,
              max: condition === 'heure=' ? 1 : max,
              pause: 10,
              declenchements: 0,
              expiration: expiration ?? undefined,
            };
            maj((e) => ({ ...e, alertes: actuelle ? e.alertes.map((x) => (x.id === a.id ? a : x)) : [...e.alertes, a] }));
            vibrer(15);
            retour();
          }}
        >
          {actuelle ? 'ENREGISTRER' : 'CRÉER'}
        </button>
      </div>
    </div>
  );
}

// ---------- Profondeur du marché ----------

export function EcranProfondeur({ nom }: { nom: string }) {
  const { etat, cotations, operer } = useTerminal();
  const { pousser } = useNav();
  const s = symbole(nom)!;
  const [carnet, setCarnet] = useState<Carnet | null>(null);
  const [volume, setVolume] = useState(Math.max(s.volumeMin, etat.volumeDefaut));
  useEffect(() => (s.direct.binance ? abonnerProfondeur(s.direct.binance, setCarnet) : undefined), [s]);
  const max = carnet ? Math.max(...carnet.bids.slice(0, 10).map((b) => b[1]), ...carnet.asks.slice(0, 10).map((a) => a[1])) : 1;
  const passer = (type: 'buy' | 'sell') => {
    if (!etat.unClicAccepte) return pousser({ type: 'unclic' });
    const r = operer((c) => ouvrirMarche(c, { symbole: nom, type, volume, sl: 0, tp: 0, commentaire: '' }, cotations), { confirmation: false });
    vibrer(r.erreur ? 40 : 20);
  };
  const q = cotations[nom];
  return (
    <div className="mm-ecran">
      <EnTete titre="Profondeur du marché" sousTitre={nom} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        {!s.direct.binance ? (
          <div className="mm-vide grand">La profondeur du marché n'est disponible que pour la crypto (carnet d'ordres Binance).</div>
        ) : !carnet ? (
          <div className="mm-vide grand">Connexion au carnet d'ordres…</div>
        ) : (
          <table className="mm-dom">
            <tbody>
              {carnet.asks
                .slice(0, 10)
                .reverse()
                .map(([p, v]) => (
                  <tr key={`a${p}`} className="ask">
                    <td />
                    <td className="prix">{formaterPrix(s, p)}</td>
                    <td className="vol">
                      <i style={{ width: `${(v / max) * 100}%` }} />
                      <span>{v.toFixed(4)}</span>
                    </td>
                  </tr>
                ))}
              <tr className="milieu">
                <td colSpan={3}>{q ? `Spread du carnet : ${(carnet.asks[0][0] - carnet.bids[0][0]).toFixed(s.chiffres)}` : ''}</td>
              </tr>
              {carnet.bids.slice(0, 10).map(([p, v]) => (
                <tr key={`b${p}`} className="bid">
                  <td className="vol">
                    <i style={{ width: `${(v / max) * 100}%` }} />
                    <span>{v.toFixed(4)}</span>
                  </td>
                  <td className="prix">{formaterPrix(s, p)}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mm-note">Volumes en {s.base}, carnet réel Binance {s.direct.binance}. Vos ordres s'exécutent au Bid / Ask de votre compte.</p>
      </div>
      {s.direct.binance && (
        <div className="mm-boutons-bas colonne">
          <ChampVolume valeur={volume} changer={setVolume} min={s.volumeMin} max={s.volumeMax} pasMin={s.pasVolume} />
          <div className="mm-ligne-boutons">
            <button className="mm-bouton vente" disabled={!q} onClick={() => passer('sell')}>
              SELL {q ? formaterPrix(s, q.bid) : ''}
            </button>
            <button className="mm-bouton achat" disabled={!q} onClick={() => passer('buy')}>
              BUY {q ? formaterPrix(s, q.ask) : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Expert Advisors ----------

export function EcranExperts() {
  const { etat, maj, compte, cotations, ouvrir } = useTerminal();
  const { pousser } = useNav();
  const attaches = etat.graphiques.filter((g) => g.expert);
  return (
    <div className="mm-ecran">
      <EnTete titre="Expert Advisors" gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-bloc ligne">
          <div>
            <b>Algo Trading</b>
            <div className="mm-note sans-marge">Autorise les experts à trader sur cet appareil.</div>
          </div>
          <Interrupteur actif={etat.algo} libelle="Algo Trading" changer={(v) => maj((e) => ({ ...e, algo: v }))} />
        </div>
        <div className="mm-section">Experts attachés</div>
        <ul className="mm-liste">
          {attaches.map((g) => {
            const e = g.expert!;
            const pos = compte.positions.filter((p) => p.magic === e.magic);
            const flottant = pos.reduce((t, p) => t + profitPosition(p, cotations), 0);
            return (
              <li key={g.id} className="fleche" onClick={() => pousser({ type: 'expert', graphique: g.id, expert: e.type })}>
                <span className={`mm-ico ${etat.algo ? 'bleu' : 'gris'}`}>🎓</span>
                <div className="mm-liste-texte">
                  <b>{definitionExpert(e.type).nom}</b>
                  <small>
                    {g.symbole}, {g.periode} · {pos.length} position{pos.length > 1 ? 's' : ''}
                    {pos.length ? ` · ${argent(flottant)} USD` : ''}
                  </small>
                </div>
              </li>
            );
          })}
          {attaches.length === 0 && <li className="mm-vide">Aucun expert attaché</li>}
        </ul>
        <div className="mm-section">Mes experts (assistant)</div>
        <ul className="mm-liste">
          {etat.expertsPerso.map((x) => (
            <li key={x.id} className="fleche" onClick={() => ouvrir({ type: 'assistant', id: x.id })}>
              <span className="mm-ico orange">🧩</span>
              <div className="mm-liste-texte">
                <b>{x.nom}</b>
                <small>Modifier les conditions</small>
              </div>
            </li>
          ))}
          <li className="fleche" onClick={() => ouvrir({ type: 'assistant' })}>
            <span className="mm-ico vert">＋</span>Créer un expert (sans code)
          </li>
        </ul>
        <div className="mm-section">Attacher au graphique actuel</div>
        <ul className="mm-liste">
          {tousExperts().map((x) => (
            <li key={x.type} className="fleche" onClick={() => pousser({ type: 'expert', graphique: etat.graphiqueActif, expert: x.type })}>
              <span className="mm-ico violet">{x.type.startsWith('perso:') ? '🧩' : '🎓'}</span>
              <div className="mm-liste-texte">
                <b>{x.nom}</b>
                <small>{x.description}</small>
              </div>
            </li>
          ))}
        </ul>
        <p className="mm-note">Les experts décident à la clôture de chaque barre et ne tradent que pendant que l'application est ouverte. Activez l'Algo Trading sur un seul appareil.</p>
      </div>
    </div>
  );
}

export function EcranExpert({ graphique, expert }: { graphique: string; expert?: TypeExpert }) {
  const { etat, majGraphique } = useTerminal();
  const { retour } = useNav();
  const g = etat.graphiques.find((x) => x.id === graphique) ?? etat.graphiques[0];
  const [type, setType] = useState<TypeExpert>(expert ?? g?.expert?.type ?? 'croisement-ma');
  const def = definitionExpert(type);
  const [p, setP] = useState<Record<string, number>>(g?.expert?.type === type ? { ...def.defaut, ...g.expert.p } : def.defaut);
  useEffect(() => {
    setP(g?.expert?.type === type ? { ...definitionExpert(type).defaut, ...g.expert.p } : definitionExpert(type).defaut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
  if (!g) return null;
  const actuel = g.expert;
  return (
    <div className="mm-ecran">
      <EnTete titre="Expert Advisor" sousTitre={`${g.symbole}, ${g.periode}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <label className="mm-ligne-champ">
            <span>Expert</span>
            <select value={type} onChange={(e) => setType(e.target.value as TypeExpert)}>
              {tousExperts().map((x) => (
                <option key={x.type} value={x.type}>
                  {x.nom}
                </option>
              ))}
            </select>
          </label>
          {Object.keys(def.defaut).map((k) => (
            <div key={k} className="mm-ligne-champ">
              <span>{def.libelles[k]}</span>
              <ChampPas valeur={p[k] ?? def.defaut[k]} changer={(v) => setP({ ...p, [k]: v })} pas={k === 'volume' ? 0.01 : k === 'sl' || k === 'tp' ? 50 : 1} min={k === 'volume' ? 0.01 : 0} decimales={k === 'volume' ? 2 : 0} />
            </div>
          ))}
        </div>
        <p className="mm-note">{def.description}</p>
      </div>
      <div className="mm-boutons-bas">
        {actuel && (
          <button
            className="mm-bouton vente"
            onClick={() => {
              majGraphique(g.id, { expert: null });
              retour();
            }}
          >
            RETIRER
          </button>
        )}
        <button
          className="mm-bouton principal"
          onClick={() => {
            const magic = actuel?.type === type ? actuel.magic : 100000 + Math.floor(Math.random() * 900000);
            majGraphique(g.id, { expert: { type, p, magic } });
            vibrer(15);
            retour();
          }}
        >
          {actuel ? 'ENREGISTRER' : 'ATTACHER'}
        </button>
      </div>
    </div>
  );
}

// ---------- Dépôt / retrait ----------

export function EcranDepot() {
  const { compte, operer } = useTerminal();
  const { retour } = useNav();
  const [sens, setSens] = useState<'depot' | 'retrait'>('depot');
  const [montant, setMontant] = useState(1000);
  return (
    <div className="mm-ecran">
      <EnTete titre="Dépôt / retrait" sousTitre={`${compte.login} · démo`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-segments-cadre">
          <Segments<'depot' | 'retrait'>
            valeur={sens}
            changer={setSens}
            options={[
              ['depot', 'Dépôt'],
              ['retrait', 'Retrait'],
            ]}
          />
        </div>
        <div className="mm-formulaire">
          <div className="mm-ligne-champ">
            <span>Montant (USD)</span>
            <ChampPas valeur={montant} changer={setMontant} pas={100} min={1} decimales={2} />
          </div>
          <div className="mm-raccourcis">
            {[100, 1000, 5000, 10000].map((v) => (
              <button key={v} onClick={() => setMontant(v)}>
                {argent(v, 0)}
              </button>
            ))}
          </div>
        </div>
        <p className="mm-note">Solde actuel : {argent(compte.solde)} USD. Argent fictif : compte de démonstration.</p>
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton principal"
          onClick={() => {
            const r = operer((c) => operationBalance(c, sens === 'depot' ? montant : -montant, sens === 'depot' ? 'Dépôt de démonstration' : 'Retrait de démonstration'), { confirmation: false });
            if (!r.erreur) {
              vibrer(20);
              retour();
            }
          }}
        >
          {sens === 'depot' ? 'DÉPOSER' : 'RETIRER'} {argent(montant)} USD
        </button>
      </div>
    </div>
  );
}


// ---------- Trading en un clic : avertissement ----------

export function EcranUnClic() {
  const { maj } = useTerminal();
  const { retour } = useNav();
  const [accepte, setAccepte] = useState(false);
  return (
    <div className="mm-ecran">
      <EnTete titre="Trading en un clic" gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-bloc">
          <p>
            Le trading en un clic envoie vos ordres <b>immédiatement, sans confirmation</b> : chaque appui sur SELL ou BUY (graphique, profondeur du marché) ouvre une position au prix du marché.
          </p>
          <p className="mm-note sans-marge">Vous pourrez le désactiver à tout moment dans Paramètres.</p>
        </div>
        <div className="mm-bloc ligne">
          J'ai compris et j'accepte
          <Interrupteur actif={accepte} libelle="J'accepte" changer={setAccepte} />
        </div>
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton principal"
          disabled={!accepte}
          onClick={() => {
            maj((e) => ({ ...e, unClicAccepte: true }));
            vibrer(20);
            retour();
          }}
        >
          ACTIVER
        </button>
      </div>
    </div>
  );
}

// ---------- Stop suiveur personnalisé ----------

export function EcranSuiveur({ ticket }: { ticket: number }) {
  const { compte, operer } = useTerminal();
  const { retour } = useNav();
  const p = compte.positions.find((x) => x.ticket === ticket);
  const [points, setPoints] = useState(p?.suiveur || 200);
  if (!p) return null;
  const s = symbole(p.symbole)!;
  return (
    <div className="mm-ecran">
      <EnTete titre="Stop suiveur" sousTitre={`#${p.ticket} ${p.symbole}, ${p.type} ${p.volume.toFixed(2)}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <div className="mm-ligne-champ">
            <span>Distance (points)</span>
            <ChampPas valeur={points} changer={setPoints} pas={10} min={5} decimales={0} />
          </div>
          <div className="mm-aide-ligne">
            soit {(points * point(s)).toFixed(s.chiffres)} en prix, environ {argent(points * point(s) * s.contrat * p.volume)} USD sur cette position
          </div>
        </div>
        <p className="mm-note">Le stop-loss suit le prix dès que la position gagne plus que cette distance. Comme dans MT5, il est géré par le terminal : il ne bouge que lorsque l'application est ouverte.</p>
      </div>
      <div className="mm-boutons-bas">
        {p.suiveur > 0 && (
          <button
            className="mm-bouton vente"
            onClick={() => {
              operer((c) => ({ compte: definirSuiveur(c, p.ticket, 0), erreur: null }), { silencieux: true });
              retour();
            }}
          >
            DÉSACTIVER
          </button>
        )}
        <button
          className="mm-bouton principal"
          onClick={() => {
            operer((c) => ({ compte: definirSuiveur(c, p.ticket, points), erreur: null }), { silencieux: true });
            vibrer(15);
            retour();
          }}
        >
          ACTIVER
        </button>
      </div>
    </div>
  );
}
