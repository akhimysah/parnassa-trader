import { useEffect, useState } from 'react';
import { useTerminal } from '../contexte';
import { SYMBOLES, formaterPrix, marcheOuvert, point, symbole } from '../marche/symboles';
import {
  NOMS_TYPE_ATTENTE,
  conversion,
  etatCompte,
  fermerPosition,
  margeRequise,
  modifierOrdre,
  modifierPosition,
  ouvrirMarche,
  placerOrdre,
  prixFermeture,
  sensDe,
  supprimerOrdre,
  type Expiration,
  type Sens,
  type TypeEnAttente,
} from '../compte/moteur';
import { Fenetre, PrixGros, Spin, argent, dateMT } from './ui';
import { GraphiqueTicks } from './ObservationMarche';
import { amorceStop, erreurStop, pasStop } from '../compte/stops';

function versDateLocale(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** Gain ou perte (USD) si le prix passe de `de` à `a` pour `volume` lots dans le sens `sens`. */
function resultatA(sym: string, sens: Sens, volume: number, de: number, a: number, cot: ReturnType<typeof useTerminal>['cotations']): number {
  const s = symbole(sym)!;
  return (sens === 'buy' ? a - de : de - a) * volume * s.contrat * conversion(s, cot);
}

function Estimation({ valeur }: { valeur: number | null }) {
  if (valeur === null) return null;
  return <span className={`estimation ${valeur >= 0 ? 'positif' : 'negatif'}`}>{valeur >= 0 ? '+' : ''}{argent(valeur)} USD</span>;
}

/** Fenêtre « Ordre » (F9) : exécution au marché ou ordre en attente, avec graphique des ticks. */
export function DialogueOrdre({ symboleInitial, sens, attente, prixInitial, volumeInitial }: { symboleInitial?: string; sens?: Sens; attente?: TypeEnAttente; prixInitial?: number; volumeInitial?: number }) {
  const { etat, compte, cotations, operer, fermer, ouvrir } = useTerminal();
  const [sym, setSym] = useState(symboleInitial ?? etat.graphiques.find((g) => g.id === etat.graphiqueActif)?.symbole ?? 'EURUSD');
  const s = symbole(sym)!;
  const q = cotations[sym];
  const [mode, setMode] = useState<'marche' | 'attente'>(attente ? 'attente' : 'marche');
  const [typeAttente, setTypeAttente] = useState<TypeEnAttente>(attente ?? (sens === 'sell' ? 'sell_limit' : 'buy_limit'));
  const [volume, setVolume] = useState(volumeInitial ?? Math.max(s.volumeMin, etat.volumeDefaut));
  const [sl, setSl] = useState(0);
  const [tp, setTp] = useState(0);
  const [prix, setPrix] = useState(prixInitial ?? 0);
  const [prixLimite, setPrixLimite] = useState(0);
  const [expiration, setExpiration] = useState<Expiration>('gtc');
  const [echeance, setEcheance] = useState(Date.now() + 86400000);
  const [commentaire, setCommentaire] = useState('');
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null);

  // Prix d'un ordre en attente : amorcé sur le marché à l'ouverture et au changement de symbole.
  useEffect(() => {
    if (prixInitial && sym === symboleInitial) return;
    setPrix(0);
    setSl(0);
    setTp(0);
    setVolume((v) => Math.min(s.volumeMax, Math.max(s.volumeMin, v)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);
  useEffect(() => {
    if (mode === 'attente' && prix === 0 && q) setPrix(typeAttente.startsWith('buy') ? q.ask : q.bid);
  }, [mode, q, prix, typeAttente]);

  const pas = point(s);
  const marge = q ? margeRequise(s, volume, mode === 'marche' ? q.ask : prix || q.ask, compte.levier, cotations) : 0;
  const ouvert = marcheOuvert(s);

  const passerMarche = (type: Sens) => {
    const r = operer((c) => ouvrirMarche(c, { symbole: sym, type, volume, sl, tp, commentaire }, cotations), { confirmation: false });
    setResultat(r.erreur ? { ok: false, texte: `Erreur : ${r.erreur}` } : { ok: true, texte: `Exécuté : #${r.ticket} ${r.message}` });
  };
  const placer = () => {
    const r = operer((c) => placerOrdre(c, { symbole: sym, type: typeAttente, volume, prix, prixLimite, sl, tp, expiration, echeance, commentaire }, cotations), { confirmation: false });
    setResultat(r.erreur ? { ok: false, texte: `Erreur : ${r.erreur}` } : { ok: true, texte: `Placé : #${r.ticket} ${r.message}` });
  };

  // Au marché, le sens se déduit du stop-loss (sous le prix : achat, au-dessus : vente) pour estimer le risque.
  const entreeSens: Sens = mode === 'marche' ? (sl && q && sl > q.bid ? 'sell' : 'buy') : sensDe(typeAttente);
  const prixEntree = mode === 'marche' ? (entreeSens === 'sell' ? q?.bid : q?.ask) : typeAttente.endsWith('stop_limit') ? prixLimite : prix;
  const { fondsPropres, margeLibre } = etatCompte(compte, cotations);
  const perte = sl && prixEntree ? resultatA(sym, entreeSens, volume, prixEntree, sl, cotations) : null;
  const gain = tp && prixEntree ? resultatA(sym, entreeSens, volume, prixEntree, tp, cotations) : null;
  const [risquePct, setRisquePct] = useState(1);
  /** Volume pour perdre `risquePct` % des fonds propres si le stop-loss est touché, plafonné par la marge libre. */
  const ajusterVolume = () => {
    if (!sl || !prixEntree) return;
    const parLot = Math.abs(resultatA(sym, entreeSens, 1, prixEntree, sl, cotations));
    const margeParLot = margeRequise(s, 1, prixEntree, compte.levier, cotations);
    const plafond = Math.min(s.volumeMax, margeParLot > 0 ? margeLibre / margeParLot : s.volumeMax);
    const brut = parLot > 0 ? (fondsPropres * risquePct) / 100 / parLot : 0;
    setVolume(Number(Math.max(s.volumeMin, Math.floor(Math.min(brut, plafond) / s.pasVolume) * s.pasVolume).toFixed(2)));
  };

  if (resultat) {
    return (
      <Fenetre titre={`Ordre`} fermer={fermer} largeur={420}>
        <div className={`resultat-ordre ${resultat.ok ? 'ok' : 'ko'}`}>
          <div className="resultat-icone">{resultat.ok ? '✔' : '✖'}</div>
          <div>{resultat.texte}</div>
        </div>
        <div className="boutons">
          {!resultat.ok && <button onClick={() => setResultat(null)}>Retour</button>}
          <button className="principal" onClick={fermer} autoFocus>
            OK
          </button>
        </div>
      </Fenetre>
    );
  }

  return (
    <Fenetre titre={`Ordre`} fermer={fermer} largeur={720} className="fenetre-ordre">
      <div className="ordre-grille">
        <div className="ordre-ticks">
          <div className="ordre-ticks-titre">
            {sym}, {s.description}
          </div>
          <GraphiqueTicks nom={sym} hauteur={300} />
        </div>
        <div className="ordre-form">
          <label>
            <span>Symbole :</span>
            <select value={sym} onChange={(e) => setSym(e.target.value)}>
              {SYMBOLES.map((x) => (
                <option key={x.nom} value={x.nom}>
                  {x.nom}, {x.description}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Type :</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'marche' | 'attente')}>
              <option value="marche">Exécution au marché</option>
              <option value="attente">Ordre en attente</option>
            </select>
          </label>
          <label>
            <span>Volume :</span>
            <Spin valeur={volume} changer={setVolume} pas={s.pasVolume} min={s.volumeMin} max={s.volumeMax} decimales={2} />
            <small className="aide">
              {argent(volume * s.contrat, 0)} {s.base} · marge {argent(marge)} USD
            </small>
          </label>
          <div className="ordre-stops">
            <label>
              <span>Stop Loss :</span>
              <Spin valeur={sl} changer={setSl} pas={pasStop(s, prixEntree ?? 1)} decimales={s.chiffres} vide amorce={prixEntree ? amorceStop(s, prixEntree, entreeSens, 'sl') : undefined} />
              <Estimation valeur={sl && prixEntree ? resultatA(sym, entreeSens, volume, prixEntree, sl, cotations) : null} />
              {mode === 'attente' && prixEntree && erreurStop(s, entreeSens, prixEntree, 'sl', sl) && <small className="erreur-champ">{erreurStop(s, entreeSens, prixEntree, 'sl', sl)}</small>}
            </label>
            <label>
              <span>Take Profit :</span>
              <Spin valeur={tp} changer={setTp} pas={pasStop(s, prixEntree ?? 1)} decimales={s.chiffres} vide amorce={prixEntree ? amorceStop(s, prixEntree, entreeSens, 'tp') : undefined} />
              <Estimation valeur={tp && prixEntree ? resultatA(sym, entreeSens, volume, prixEntree, tp, cotations) : null} />
              {mode === 'attente' && prixEntree && erreurStop(s, entreeSens, prixEntree, 'tp', tp) && <small className="erreur-champ">{erreurStop(s, entreeSens, prixEntree, 'tp', tp)}</small>}
            </label>
          </div>
          <div className="ordre-risque">
            <span>Risque :</span>
            <select value={risquePct} onChange={(e) => setRisquePct(Number(e.target.value))} title="Part des fonds propres perdue si le stop-loss est touché">
              {[0.25, 0.5, 1, 2, 3, 5].map((v) => (
                <option key={v} value={v}>
                  {v} %
                </option>
              ))}
            </select>
            <button disabled={!sl || !prixEntree} onClick={ajusterVolume} title={sl ? 'Calcule le volume pour ce risque' : "Placez d'abord un stop-loss"}>
              Ajuster le volume
            </button>
            <small className="aide">
              {perte !== null ? `perte au S/L ${argent(Math.abs(perte))} USD (${((Math.abs(perte) / Math.max(1, fondsPropres)) * 100).toFixed(2)} % des fonds)` : 'placez un S/L pour mesurer le risque'}
              {perte && gain ? ` · ratio gain/risque 1 : ${(Math.abs(gain) / Math.abs(perte)).toFixed(2)}` : ''}
              {mode === 'marche' && sl ? ` · ${entreeSens === 'buy' ? 'achat' : 'vente'}` : ''}
            </small>
          </div>
          {mode === 'attente' && (
            <>
              <label>
                <span>Type :</span>
                <select value={typeAttente} onChange={(e) => { setTypeAttente(e.target.value as TypeEnAttente); setPrix(0); }}>
                  {(Object.keys(NOMS_TYPE_ATTENTE) as TypeEnAttente[]).map((t) => (
                    <option key={t} value={t}>
                      {NOMS_TYPE_ATTENTE[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Au prix :</span>
                <Spin valeur={prix} changer={setPrix} pas={pas} decimales={s.chiffres} />
              </label>
              {typeAttente.endsWith('stop_limit') && (
                <label>
                  <span>Prix Stop Limit :</span>
                  <Spin valeur={prixLimite} changer={setPrixLimite} pas={pas} decimales={s.chiffres} vide amorce={prix} />
                </label>
              )}
              <label>
                <span>Expiration :</span>
                <select value={expiration} onChange={(e) => setExpiration(e.target.value as Expiration)}>
                  <option value="gtc">GTC (jusqu'à annulation)</option>
                  <option value="jour">Aujourd'hui</option>
                  <option value="date">Spécifiée</option>
                </select>
              </label>
              {expiration === 'date' && (
                <label>
                  <span>Date :</span>
                  <input type="datetime-local" value={versDateLocale(echeance)} onChange={(e) => setEcheance(new Date(e.target.value).getTime())} />
                </label>
              )}
            </>
          )}
          <label>
            <span>Commentaire :</span>
            <input value={commentaire} maxLength={31} onChange={(e) => setCommentaire(e.target.value)} />
          </label>
          {mode === 'marche' ? (
            <>
              <div className="ordre-prix">
                <span className="baisse">
                  <PrixGros s={s} prix={q?.bid} />
                </span>
                <span className="slash">/</span>
                <span className="hausse">
                  <PrixGros s={s} prix={q?.ask} />
                </span>
              </div>
              {!ouvert && <div className="avertissement">Marché fermé</div>}
              {marge > margeLibre && <div className="avertissement">Marge libre insuffisante ({argent(margeLibre)} USD)</div>}
              <div className="ordre-boutons">
                <button className="vente" disabled={!q || !ouvert} onClick={() => passerMarche('sell')}>
                  Vente au marché
                </button>
                <button className="achat" disabled={!q || !ouvert} onClick={() => passerMarche('buy')}>
                  Achat au marché
                </button>
              </div>
              <p className="aide">L'exécution se fait au prix du marché, sans requote. Achat à l'Ask, vente au Bid.</p>
            </>
          ) : (
            <>
              {!ouvert && <div className="avertissement">Marché fermé</div>}
              <div className="ordre-boutons">
                <button className="principal large" disabled={!q || !ouvert} onClick={placer}>
                  Placer
                </button>
              </div>
            </>
          )}
          <button className="lien" onClick={() => ouvrir({ type: 'specification', symbole: sym })}>
            Spécification du symbole
          </button>
        </div>
      </div>
    </Fenetre>
  );
}

/** Modifier une position : stop-loss, take-profit, fermeture totale ou partielle. */
export function DialogueModifierPosition({ ticket }: { ticket: number }) {
  const { compte, cotations, operer, fermer } = useTerminal();
  const p = compte.positions.find((x) => x.ticket === ticket);
  const [sl, setSl] = useState(p?.sl ?? 0);
  const [tp, setTp] = useState(p?.tp ?? 0);
  const [volume, setVolume] = useState(p?.volume ?? 0);
  const [points, setPoints] = useState(0);
  if (!p) {
    return (
      <Fenetre titre="Position" fermer={fermer}>
        <p>Cette position est déjà fermée.</p>
        <div className="boutons">
          <button onClick={fermer}>OK</button>
        </div>
      </Fenetre>
    );
  }
  const s = symbole(p.symbole)!;
  const q = cotations[p.symbole];
  const actuel = q ? prixFermeture(p.type, q) : p.prixOuverture;
  const copier = () => {
    if (!points) return;
    const d = points * point(s);
    setSl(Number((p.type === 'buy' ? actuel - d : actuel + d).toFixed(s.chiffres)));
    setTp(Number((p.type === 'buy' ? actuel + d : actuel - d).toFixed(s.chiffres)));
  };
  return (
    <Fenetre titre={`Position #${p.ticket} ${p.type} ${p.volume.toFixed(2)} ${p.symbole}`} fermer={fermer} largeur={720} className="fenetre-ordre">
      <div className="ordre-grille">
        <div className="ordre-ticks">
          <div className="ordre-ticks-titre">
            {p.symbole}, {s.description}
          </div>
          <GraphiqueTicks nom={p.symbole} hauteur={280} />
        </div>
        <div className="ordre-form">
          <div className="recap">
            Ouverte le {dateMT(p.heure)} à <b>{formaterPrix(s, p.prixOuverture)}</b>, prix actuel <b>{formaterPrix(s, actuel)}</b>
          </div>
          <label>
            <span>Stop Loss :</span>
            <Spin valeur={sl} changer={setSl} pas={pasStop(s, actuel)} decimales={s.chiffres} vide amorce={amorceStop(s, actuel, p.type, 'sl')} />
            <Estimation valeur={sl ? resultatA(p.symbole, p.type, p.volume, p.prixOuverture, sl, cotations) : null} />
            {erreurStop(s, p.type, actuel, 'sl', sl) && <small className="erreur-champ">{erreurStop(s, p.type, actuel, 'sl', sl)}</small>}
          </label>
          <label>
            <span>Take Profit :</span>
            <Spin valeur={tp} changer={setTp} pas={pasStop(s, actuel)} decimales={s.chiffres} vide amorce={amorceStop(s, actuel, p.type, 'tp')} />
            <Estimation valeur={tp ? resultatA(p.symbole, p.type, p.volume, p.prixOuverture, tp, cotations) : null} />
            {erreurStop(s, p.type, actuel, 'tp', tp) && <small className="erreur-champ">{erreurStop(s, p.type, actuel, 'tp', tp)}</small>}
          </label>
          <label>
            <span>Copier à :</span>
            <Spin valeur={points} changer={setPoints} pas={10} decimales={0} />
            <button onClick={copier}>points</button>
          </label>
          <div className="ordre-boutons">
            <button
              className="principal large"
              disabled={Boolean(erreurStop(s, p.type, actuel, 'sl', sl) || erreurStop(s, p.type, actuel, 'tp', tp))}
              onClick={() => {
                const r = operer((c) => modifierPosition(c, p.ticket, sl, tp, cotations), { confirmation: false });
                if (!r.erreur) fermer();
              }}
            >
              Modifier
            </button>
          </div>
          <hr />
          <label>
            <span>Volume à fermer :</span>
            <Spin valeur={volume} changer={setVolume} pas={s.pasVolume} min={s.volumeMin} max={p.volume} decimales={2} />
          </label>
          <div className="ordre-boutons">
            <button
              className="fermer-pos large"
              onClick={() => {
                const r = operer((c) => fermerPosition(c, p.ticket, cotations, volume), { confirmation: false });
                if (!r.erreur) fermer();
              }}
            >
              Fermer #{p.ticket} {p.type} {volume.toFixed(2)} {p.symbole} à {q ? formaterPrix(s, actuel) : '—'}
            </button>
          </div>
        </div>
      </div>
    </Fenetre>
  );
}

/** Modifier ou supprimer un ordre en attente. */
export function DialogueModifierOrdre({ ticket }: { ticket: number }) {
  const { compte, cotations, operer, fermer } = useTerminal();
  const o = compte.ordres.find((x) => x.ticket === ticket);
  const [prix, setPrix] = useState(o?.prix ?? 0);
  const [prixLimite, setPrixLimite] = useState(o?.prixLimite ?? 0);
  const [sl, setSl] = useState(o?.sl ?? 0);
  const [tp, setTp] = useState(o?.tp ?? 0);
  const [expiration, setExpiration] = useState<Expiration>(o?.expiration ?? 'gtc');
  const [echeance, setEcheance] = useState(o?.echeance || Date.now() + 86400000);
  if (!o) {
    return (
      <Fenetre titre="Ordre" fermer={fermer}>
        <p>Cet ordre n'existe plus (exécuté ou supprimé).</p>
        <div className="boutons">
          <button onClick={fermer}>OK</button>
        </div>
      </Fenetre>
    );
  }
  const s = symbole(o.symbole)!;
  return (
    <Fenetre titre={`Ordre #${o.ticket} ${NOMS_TYPE_ATTENTE[o.type]} ${o.volume.toFixed(2)} ${o.symbole}`} fermer={fermer} largeur={720} className="fenetre-ordre">
      <div className="ordre-grille">
        <div className="ordre-ticks">
          <div className="ordre-ticks-titre">
            {o.symbole}, {s.description}
          </div>
          <GraphiqueTicks nom={o.symbole} hauteur={280} />
        </div>
        <div className="ordre-form">
          <label>
            <span>Au prix :</span>
            <Spin valeur={prix} changer={setPrix} pas={point(s)} decimales={s.chiffres} />
          </label>
          {o.type.endsWith('stop_limit') && (
            <label>
              <span>Prix Stop Limit :</span>
              <Spin valeur={prixLimite} changer={setPrixLimite} pas={point(s)} decimales={s.chiffres} />
            </label>
          )}
          <label>
            <span>Stop Loss :</span>
            <Spin valeur={sl} changer={setSl} pas={point(s)} decimales={s.chiffres} vide amorce={prix} />
          </label>
          <label>
            <span>Take Profit :</span>
            <Spin valeur={tp} changer={setTp} pas={point(s)} decimales={s.chiffres} vide amorce={prix} />
          </label>
          <label>
            <span>Expiration :</span>
            <select value={expiration} onChange={(e) => setExpiration(e.target.value as Expiration)}>
              <option value="gtc">GTC (jusqu'à annulation)</option>
              <option value="jour">Aujourd'hui</option>
              <option value="date">Spécifiée</option>
            </select>
          </label>
          {expiration === 'date' && (
            <label>
              <span>Date :</span>
              <input type="datetime-local" value={versDateLocale(echeance)} onChange={(e) => setEcheance(new Date(e.target.value).getTime())} />
            </label>
          )}
          <div className="ordre-boutons">
            <button
              className="principal"
              onClick={() => {
                const r = operer((c) => modifierOrdre(c, o.ticket, { prix, prixLimite, sl, tp, expiration, echeance }, cotations), { confirmation: false });
                if (!r.erreur) fermer();
              }}
            >
              Modifier
            </button>
            <button
              className="vente"
              onClick={() => {
                operer((c) => supprimerOrdre(c, o.ticket), { confirmation: false });
                fermer();
              }}
            >
              Supprimer
            </button>
          </div>
        </div>
      </div>
    </Fenetre>
  );
}
