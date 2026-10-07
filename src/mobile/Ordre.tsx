import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { formaterPrix, marcheOuvert, point, symbole } from '../marche/symboles';
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
  profitPosition,
  sensDe,
  supprimerOrdre,
  type Expiration,
  type Sens,
  type TypeEnAttente,
} from '../compte/moteur';
import { GraphiqueTicks } from '../composants/ObservationMarche';
import { amorceStop, erreurStop, pasStop } from '../compte/stops';
import { PrixGros, argent, dateMT } from '../composants/ui';
import { BoutonRetour, ChampPas, ChampVolume, EnTete, Segments, useNav, vibrer } from './commun';

type TypeOrdre = 'marche' | TypeEnAttente;

const TYPES: [TypeOrdre, string][] = [['marche', 'Exécution au marché'], ...(Object.entries(NOMS_TYPE_ATTENTE) as [TypeEnAttente, string][])];

function versDateLocale(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Gain (ou perte) en USD si le prix va de `de` à `a`. */
function enArgent(sym: string, sens: Sens, volume: number, de: number, a: number, cot: ReturnType<typeof useTerminal>['cotations']): number {
  const s = symbole(sym)!;
  return (sens === 'buy' ? a - de : de - a) * volume * s.contrat * conversion(s, cot);
}

function ErreurStop({ texte }: { texte: string | null }) {
  return texte ? <div className="mm-erreur-champ">{texte}</div> : null;
}

function Montant({ v }: { v: number | null }) {
  if (v === null) return null;
  return <span className={`mm-montant ${v >= 0 ? 'positif' : 'negatif'}`}>{`${v >= 0 ? '+' : ''}${argent(v)} USD`}</span>;
}

/** Prix Bid / Ask en grand, comme au-dessus des boutons de l'écran d'ordre MT5. */
function DeuxPrix({ nom }: { nom: string }) {
  const { cotations } = useTerminal();
  const s = symbole(nom)!;
  const c = cotations[nom];
  return (
    <div className="mm-deux-prix">
      <div className="baisse">
        <PrixGros s={s} prix={c?.bid} />
      </div>
      <div className="hausse">
        <PrixGros s={s} prix={c?.ask} />
      </div>
    </div>
  );
}

/** Écran « Nouvel ordre ». */
export function EcranOrdre({ symboleInitial, attente, typeInitial, prixInitial }: { symboleInitial: string; attente?: boolean; typeInitial?: TypeEnAttente; prixInitial?: number }) {
  const { etat, compte, cotations, operer } = useTerminal();
  const { pousser, feuille } = useNav();
  const [sym, setSym] = useState(symboleInitial);
  const s = symbole(sym)!;
  const q = cotations[sym];
  const [type, setType] = useState<TypeOrdre>(typeInitial ?? (attente ? 'buy_limit' : 'marche'));
  const [volume, setVolume] = useState(Math.max(s.volumeMin, etat.volumeDefaut));
  const [prix, setPrix] = useState(prixInitial ?? 0);
  const [prixLimite, setPrixLimite] = useState(0);
  const [sl, setSl] = useState(0);
  const [tp, setTp] = useState(0);
  const [expiration, setExpiration] = useState<Expiration>('gtc');
  const [echeance, setEcheance] = useState(Date.now() + 86400000);
  const [commentaire, setCommentaire] = useState('');
  // Stops en points : la distance est fixée maintenant, le prix exact du S/L / T/P au moment de l'ordre (selon le sens).
  const [modeStops, setModeStops] = useState<'prix' | 'points'>('prix');
  const [slPts, setSlPts] = useState(0);
  const [tpPts, setTpPts] = useState(0);
  const stopsDepuisPoints = (entree: number, cote: Sens) => {
    const f = cote === 'buy' ? 1 : -1;
    const arr = (v: number) => Number(v.toFixed(s.chiffres));
    return { sl: slPts ? arr(entree - f * slPts * point(s)) : 0, tp: tpPts ? arr(entree + f * tpPts * point(s)) : 0 };
  };

  // Changement de symbole : les prix ne valent plus (le prix reçu à l'ouverture de l'écran est gardé).
  const symPrecedent = useRef(sym);
  useEffect(() => {
    if (symPrecedent.current === sym) return;
    symPrecedent.current = sym;
    setPrix(0);
    setSl(0);
    setTp(0);
    setVolume((v) => Math.min(s.volumeMax, Math.max(s.volumeMin, v)));
  }, [sym]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (type !== 'marche' && prix === 0 && q) setPrix(type.startsWith('buy') ? q.ask : q.bid);
  }, [type, prix, q]);

  const pas = point(s);
  const pasS = pasStop(s, q ? q.bid : prix || 1);
  const marge = q ? margeRequise(s, volume, type === 'marche' ? q.ask : prix || q.ask, compte.levier, cotations) : 0;
  const libre = etatCompte(compte, cotations).margeLibre;
  const ouvert = marcheOuvert(s);
  const prixEntree = type === 'marche' ? q?.ask : type.endsWith('stop_limit') ? prixLimite : prix;
  const sens: Sens = type === 'marche' ? 'buy' : sensDe(type);

  // Calculateur de risque : volume pour perdre au plus x % des fonds propres si le S/L est touché.
  const calculerRisque = () => {
    if (!sl || !prixEntree) {
      feuille('Volume selon le risque', [{ libelle: 'Placez d’abord un S/L : le risque se mesure entre l’entrée et le stop', action: () => undefined }]);
      return;
    }
    const { fondsPropres, margeLibre } = etatCompte(compte, cotations);
    const parLot = Math.abs(enArgent(sym, sens, 1, prixEntree, sl, cotations));
    // Le volume est aussi plafonné par la marge libre (sinon l'ordre serait refusé).
    const margeParLot = margeRequise(s, 1, prixEntree, compte.levier, cotations);
    const maxMarge = margeParLot > 0 ? margeLibre / margeParLot : s.volumeMax;
    feuille(
      `Risque jusqu'au S/L (fonds propres ${argent(fondsPropres)} USD)`,
      [0.5, 1, 2, 3, 5].map((pct) => {
        const brut = parLot > 0 ? (fondsPropres * pct) / 100 / parLot : 0;
        const plafond = Math.min(s.volumeMax, maxMarge);
        const v = Number(Math.max(s.volumeMin, Math.floor(Math.min(brut, plafond) / s.pasVolume) * s.pasVolume).toFixed(2));
        const limite = brut > plafond ? (maxMarge < s.volumeMax ? ' — limité par la marge' : ' — volume maximal') : '';
        return { libelle: `${pct} % → ${v.toFixed(2)} lot, perte ${argent(parLot * v)} USD${limite}`, action: () => setVolume(v) };
      }),
    );
  };

  const termine = (r: { erreur: string | null; message?: string; ticket?: number }, titreOk: string) => {
    if (r.erreur) {
      vibrer(40);
      pousser({ type: 'resultat', ok: false, titre: 'Ordre refusé', texte: r.erreur });
    } else {
      vibrer(20);
      pousser({ type: 'resultat', ok: true, titre: titreOk, texte: `#${r.ticket} ${r.message ?? ''}` });
    }
  };
  const marche = (t: Sens) => {
    const st = modeStops === 'points' && q ? stopsDepuisPoints(t === 'buy' ? q.ask : q.bid, t) : { sl, tp };
    termine(operer((c) => ouvrirMarche(c, { symbole: sym, type: t, volume, sl: st.sl, tp: st.tp, commentaire }, cotations), { confirmation: false, silencieux: true }), 'Ordre exécuté');
  };
  const placer = () => {
    if (type === 'marche') return;
    const st = modeStops === 'points' ? stopsDepuisPoints(type.endsWith('stop_limit') ? prixLimite : prix, sensDe(type)) : { sl, tp };
    termine(operer((c) => placerOrdre(c, { symbole: sym, type, volume, prix, prixLimite, sl: st.sl, tp: st.tp, expiration, echeance, commentaire }, cotations), { confirmation: false, silencieux: true }), 'Ordre placé');
  };

  return (
    <div className="mm-ecran mm-ordre">
      <EnTete
        titre={
          <button className="mm-titre-bouton" onClick={() => feuille('Symbole', etat.observation.map((n) => ({ libelle: `${n} — ${symbole(n)?.description}`, action: () => setSym(n) })))}>
            {sym} ▾
          </button>
        }
        sousTitre={s.description}
        gauche={<BoutonRetour />}
      />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <label className="mm-ligne-champ">
            <span>Type</span>
            <select value={type} onChange={(e) => { setType(e.target.value as TypeOrdre); setPrix(0); }}>
              {TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <ChampVolume valeur={volume} changer={setVolume} min={s.volumeMin} max={s.volumeMax} pasMin={s.pasVolume} />
          <div className="mm-aide-ligne">
            {argent(volume * s.contrat, 0)} {s.base} · marge {argent(marge)} USD{marge > libre ? ' · marge libre insuffisante' : ''}
            {' · '}
            <button className="mm-lien" onClick={calculerRisque}>
              volume selon le risque
            </button>
          </div>
          {type !== 'marche' && (
            <div className="mm-ligne-champ">
              <span>Prix</span>
              <ChampPas valeur={prix} changer={setPrix} pas={pasS} decimales={s.chiffres} />
            </div>
          )}
          {type.endsWith('stop_limit') && (
            <div className="mm-ligne-champ">
              <span>Stop Limit</span>
              <ChampPas valeur={prixLimite} changer={setPrixLimite} pas={pas} decimales={s.chiffres} vide amorce={prix} placeholder="non défini" />
            </div>
          )}
          <div className="mm-ligne-champ">
            <span>Stops en</span>
            <Segments<'prix' | 'points'>
              valeur={modeStops}
              changer={setModeStops}
              options={[
                ['prix', 'Prix'],
                ['points', 'Points'],
              ]}
            />
          </div>
          {modeStops === 'prix' ? (
            <>
              <div className="mm-ligne-champ">
                <span>S/L</span>
                <ChampPas valeur={sl} changer={setSl} pas={pasS} decimales={s.chiffres} vide amorce={prixEntree ? amorceStop(s, prixEntree, sens, 'sl') : undefined} placeholder="non défini" />
              </div>
              {sl > 0 && prixEntree && (
                <div className="mm-aide-ligne">
                  <Montant v={enArgent(sym, sens, volume, prixEntree, sl, cotations)} />
                </div>
              )}
              {type !== 'marche' && <ErreurStop texte={prixEntree ? erreurStop(s, sens, prixEntree, 'sl', sl) : null} />}
              <div className="mm-ligne-champ">
                <span>T/P</span>
                <ChampPas valeur={tp} changer={setTp} pas={pasS} decimales={s.chiffres} vide amorce={prixEntree ? amorceStop(s, prixEntree, sens, 'tp') : undefined} placeholder="non défini" />
              </div>
              {tp > 0 && prixEntree && (
                <div className="mm-aide-ligne">
                  <Montant v={enArgent(sym, sens, volume, prixEntree, tp, cotations)} />
                </div>
              )}
              {type !== 'marche' && <ErreurStop texte={prixEntree ? erreurStop(s, sens, prixEntree, 'tp', tp) : null} />}
              {type === 'marche' && (sl > 0 || tp > 0) && q && (
                <div className="mm-aide-ligne">
                  {sl > 0 && tp > 0 && (sl < q.bid) !== (tp > q.ask)
                    ? 'S/L et T/P incompatibles entre eux'
                    : sl > 0 && sl < q.bid
                      ? 'Niveaux pour un ACHAT'
                      : sl > 0
                        ? 'Niveaux pour une VENTE'
                        : tp > q.ask
                          ? 'Niveau pour un ACHAT'
                          : 'Niveau pour une VENTE'}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mm-ligne-champ">
                <span>S/L (points)</span>
                <ChampPas valeur={slPts} changer={setSlPts} pas={10} decimales={0} vide placeholder="non défini" />
              </div>
              {slPts > 0 && (
                <div className="mm-aide-ligne">
                  {(slPts * pas).toFixed(s.chiffres)} de distance · <Montant v={-slPts * pas * s.contrat * volume * conversion(s, cotations)} />
                  {q && type === 'marche' ? ` · achat : ${formaterPrix(s, stopsDepuisPoints(q.ask, 'buy').sl)}, vente : ${formaterPrix(s, stopsDepuisPoints(q.bid, 'sell').sl)}` : ''}
                </div>
              )}
              <div className="mm-ligne-champ">
                <span>T/P (points)</span>
                <ChampPas valeur={tpPts} changer={setTpPts} pas={10} decimales={0} vide placeholder="non défini" />
              </div>
              {tpPts > 0 && (
                <div className="mm-aide-ligne">
                  {(tpPts * pas).toFixed(s.chiffres)} de distance · <Montant v={tpPts * pas * s.contrat * volume * conversion(s, cotations)} />
                  {q && type === 'marche' ? ` · achat : ${formaterPrix(s, stopsDepuisPoints(q.ask, 'buy').tp)}, vente : ${formaterPrix(s, stopsDepuisPoints(q.bid, 'sell').tp)}` : ''}
                </div>
              )}
            </>
          )}
          {type !== 'marche' && (
            <label className="mm-ligne-champ">
              <span>Expiration</span>
              <select value={expiration} onChange={(e) => setExpiration(e.target.value as Expiration)}>
                <option value="gtc">GTC</option>
                <option value="jour">Aujourd'hui</option>
                <option value="date">Spécifiée</option>
              </select>
            </label>
          )}
          {type !== 'marche' && expiration === 'date' && (
            <label className="mm-ligne-champ">
              <span>Date</span>
              <input type="datetime-local" value={versDateLocale(echeance)} onChange={(e) => setEcheance(new Date(e.target.value).getTime())} />
            </label>
          )}
          <label className="mm-ligne-champ">
            <span>Commentaire</span>
            <input value={commentaire} maxLength={31} placeholder="facultatif" onChange={(e) => setCommentaire(e.target.value)} />
          </label>
        </div>
        <div className="mm-ticks">
          <GraphiqueTicks
            nom={sym}
            hauteur={170}
            niveaux={[
              ...(type !== 'marche' && prix ? [{ prix, couleur: '#8e8e93', libelle: 'Prix' }] : []),
              ...(modeStops === 'prix' && sl ? [{ prix: sl, couleur: '#ff3b30', libelle: 'S/L' }] : []),
              ...(modeStops === 'prix' && tp ? [{ prix: tp, couleur: '#34c759', libelle: 'T/P' }] : []),
            ]}
          />
        </div>
        <DeuxPrix nom={sym} />
        {!ouvert && <div className="mm-alerte">Marché fermé — {sym} ne se négocie pas en ce moment.</div>}
        {type === 'marche' && <p className="mm-note">Exécution au marché sans requote : achat à l'Ask, vente au Bid.</p>}
      </div>
      <div className="mm-boutons-bas">
        {type === 'marche' ? (
          <>
            <button className="mm-bouton vente" disabled={!q || !ouvert} onClick={() => marche('sell')}>
              VENTE AU MARCHÉ
            </button>
            <button className="mm-bouton achat" disabled={!q || !ouvert} onClick={() => marche('buy')}>
              ACHAT AU MARCHÉ
            </button>
          </>
        ) : (
          <button className="mm-bouton principal" disabled={!q || !ouvert} onClick={placer}>
            PLACER
          </button>
        )}
      </div>
    </div>
  );
}

/** Résultat d'un ordre (« Done » de MT5). */
export function EcranResultat({ ok, titre, texte }: { ok: boolean; titre: string; texte: string }) {
  const { racine, retour } = useNav();
  return (
    <div className="mm-ecran mm-resultat">
      <div className="mm-resultat-corps">
        <div className={`mm-resultat-icone ${ok ? 'ok' : 'ko'}`}>{ok ? '✓' : '!'}</div>
        <h2>{titre}</h2>
        <p>{texte}</p>
      </div>
      <div className="mm-boutons-bas">
        {ok ? (
          <button className="mm-bouton principal" onClick={() => racine('trade')}>
            Terminé
          </button>
        ) : (
          <button className="mm-bouton principal" onClick={retour}>
            Retour
          </button>
        )}
      </div>
    </div>
  );
}

/** Modifier une position : S/L et T/P, avec le résultat en argent. */
export function EcranPosition({ ticket }: { ticket: number }) {
  const { compte, cotations, operer } = useTerminal();
  const { pousser, retour } = useNav();
  const p = compte.positions.find((x) => x.ticket === ticket);
  const [sl, setSl] = useState(p?.sl ?? 0);
  const [tp, setTp] = useState(p?.tp ?? 0);
  if (!p) return <Disparu />;
  const s = symbole(p.symbole)!;
  const q = cotations[p.symbole];
  const actuel = q ? prixFermeture(p.type, q) : p.prixOuverture;
  const profit = profitPosition(p, cotations);
  const pasS = pasStop(s, actuel);
  // Les stops d'une position sont contrôlés par rapport au prix de clôture actuel (Bid pour un achat, Ask pour une vente).
  const errSl = erreurStop(s, p.type, actuel, 'sl', sl);
  const errTp = erreurStop(s, p.type, actuel, 'tp', tp);
  const inchange = sl === p.sl && tp === p.tp;
  return (
    <div className="mm-ecran mm-ordre">
      <EnTete titre={`Modifier #${p.ticket}`} sousTitre={`${p.symbole}, ${p.type} ${p.volume.toFixed(2)}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-recap-position">
          <span>
            {formaterPrix(s, p.prixOuverture)} → {formaterPrix(s, actuel)}
          </span>
          <b className={profit >= 0 ? 'positif' : 'negatif'}>{argent(profit)} USD</b>
        </div>
        <div className="mm-formulaire">
          <div className="mm-ligne-champ">
            <span>S/L</span>
            <ChampPas valeur={sl} changer={setSl} pas={pasS} decimales={s.chiffres} vide amorce={amorceStop(s, actuel, p.type, 'sl')} placeholder="non défini" />
          </div>
          {sl > 0 && (
            <div className="mm-aide-ligne">
              <Montant v={enArgent(p.symbole, p.type, p.volume, p.prixOuverture, sl, cotations)} />
            </div>
          )}
          <ErreurStop texte={errSl} />
          <div className="mm-ligne-champ">
            <span>T/P</span>
            <ChampPas valeur={tp} changer={setTp} pas={pasS} decimales={s.chiffres} vide amorce={amorceStop(s, actuel, p.type, 'tp')} placeholder="non défini" />
          </div>
          {tp > 0 && (
            <div className="mm-aide-ligne">
              <Montant v={enArgent(p.symbole, p.type, p.volume, p.prixOuverture, tp, cotations)} />
            </div>
          )}
          <ErreurStop texte={errTp} />
        </div>
        <div className="mm-ticks">
          <GraphiqueTicks
            nom={p.symbole}
            hauteur={170}
            niveaux={[
              { prix: p.prixOuverture, couleur: p.type === 'buy' ? '#007aff' : '#ff3b30', libelle: `Entrée ${p.type}` },
              ...(sl ? [{ prix: sl, couleur: '#ff3b30', libelle: 'S/L' }] : []),
              ...(tp ? [{ prix: tp, couleur: '#34c759', libelle: 'T/P' }] : []),
            ]}
          />
        </div>
        <DeuxPrix nom={p.symbole} />
      </div>
      <div className="mm-boutons-bas">
        <button className="mm-bouton fermeture" onClick={() => pousser({ type: 'fermer', ticket: p.ticket })}>
          Fermer…
        </button>
        <button
          className="mm-bouton principal"
          disabled={Boolean(errSl || errTp) || inchange}
          onClick={() => {
            const r = operer((c) => modifierPosition(c, p.ticket, sl, tp, cotations), { confirmation: false });
            if (!r.erreur) {
              vibrer(20);
              retour();
            }
          }}
        >
          MODIFIER
        </button>
      </div>
    </div>
  );
}

/** Fermer une position, en totalité ou en partie (« Close with profit » de MT5). */
export function EcranFermer({ ticket }: { ticket: number }) {
  const { compte, cotations, operer } = useTerminal();
  const { pousser } = useNav();
  const p = compte.positions.find((x) => x.ticket === ticket);
  const [volume, setVolume] = useState(p?.volume ?? 0.01);
  if (!p) return <Disparu />;
  const s = symbole(p.symbole)!;
  const q = cotations[p.symbole];
  const profit = profitPosition(p, cotations) * (volume / p.volume);
  return (
    <div className="mm-ecran mm-ordre">
      <EnTete titre={`Fermer #${p.ticket}`} sousTitre={`${p.symbole}, ${p.type} ${p.volume.toFixed(2)}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <ChampVolume valeur={volume} changer={(v) => setVolume(Math.min(p.volume, v))} min={s.volumeMin} max={p.volume} pasMin={s.pasVolume} />
          <div className="mm-raccourcis">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  vibrer(6);
                  setVolume(Number(Math.min(p.volume, Math.max(s.volumeMin, Math.round((p.volume * pct) / 100 / s.pasVolume) * s.pasVolume)).toFixed(2)));
                }}
              >
                {pct} %
              </button>
            ))}
          </div>
          <div className="mm-aide-ligne">Volume ouvert : {p.volume.toFixed(2)} lot</div>
        </div>
        <div className="mm-ticks">
          <GraphiqueTicks nom={p.symbole} hauteur={170} />
        </div>
        <DeuxPrix nom={p.symbole} />
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton fermeture plein"
          disabled={!q}
          onClick={() => {
            const r = operer((c) => fermerPosition(c, p.ticket, cotations, volume), { confirmation: false, silencieux: true });
            vibrer(r.erreur ? 40 : 20);
            pousser(r.erreur ? { type: 'resultat', ok: false, titre: 'Fermeture refusée', texte: r.erreur } : { type: 'resultat', ok: true, titre: 'Position fermée', texte: r.message ?? '' });
          }}
        >
          Fermer {volume.toFixed(2)} lot avec un {profit >= 0 ? 'profit' : 'perte'} de {argent(Math.abs(profit))} USD
        </button>
      </div>
    </div>
  );
}

/** Modifier ou supprimer un ordre en attente. */
export function EcranOrdreAttente({ ticket }: { ticket: number }) {
  const { compte, cotations, operer } = useTerminal();
  const { retour } = useNav();
  const o = compte.ordres.find((x) => x.ticket === ticket);
  const [prix, setPrix] = useState(o?.prix ?? 0);
  const [sl, setSl] = useState(o?.sl ?? 0);
  const [tp, setTp] = useState(o?.tp ?? 0);
  if (!o) return <Disparu />;
  const s = symbole(o.symbole)!;
  const sensO = sensDe(o.type);
  const pasS = pasStop(s, prix);
  const errSl = erreurStop(s, sensO, prix, 'sl', sl);
  const errTp = erreurStop(s, sensO, prix, 'tp', tp);
  return (
    <div className="mm-ecran mm-ordre">
      <EnTete titre={`Ordre #${o.ticket}`} sousTitre={`${o.symbole}, ${NOMS_TYPE_ATTENTE[o.type]} ${o.volume.toFixed(2)}`} gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <div className="mm-ligne-champ">
            <span>Prix</span>
            <ChampPas valeur={prix} changer={setPrix} pas={pasS} decimales={s.chiffres} />
          </div>
          <div className="mm-ligne-champ">
            <span>S/L</span>
            <ChampPas valeur={sl} changer={setSl} pas={pasS} decimales={s.chiffres} vide amorce={amorceStop(s, prix, sensO, 'sl')} placeholder="non défini" />
          </div>
          <ErreurStop texte={errSl} />
          <div className="mm-ligne-champ">
            <span>T/P</span>
            <ChampPas valeur={tp} changer={setTp} pas={pasS} decimales={s.chiffres} vide amorce={amorceStop(s, prix, sensO, 'tp')} placeholder="non défini" />
          </div>
          <ErreurStop texte={errTp} />
          <div className="mm-aide-ligne">
            Placé le {dateMT(o.heure)} · expiration {o.expiration === 'gtc' ? 'GTC' : o.expiration === 'jour' ? "aujourd'hui" : dateMT(o.echeance, false)}
          </div>
        </div>
        <div className="mm-ticks">
          <GraphiqueTicks nom={o.symbole} hauteur={170} />
        </div>
        <DeuxPrix nom={o.symbole} />
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton vente"
          onClick={() => {
            operer((c) => supprimerOrdre(c, o.ticket), { confirmation: false });
            vibrer(20);
            retour();
          }}
        >
          SUPPRIMER
        </button>
        <button
          className="mm-bouton principal"
          disabled={Boolean(errSl || errTp)}
          onClick={() => {
            const r = operer((c) => modifierOrdre(c, o.ticket, { prix, prixLimite: o.prixLimite, sl, tp, expiration: o.expiration, echeance: o.echeance }, cotations), { confirmation: false });
            if (!r.erreur) {
              vibrer(20);
              retour();
            }
          }}
        >
          MODIFIER
        </button>
      </div>
    </div>
  );
}

function Disparu() {
  return (
    <div className="mm-ecran">
      <EnTete titre="Trade" gauche={<BoutonRetour />} />
      <div className="mm-vide grand">Cette position ou cet ordre n'existe plus.</div>
    </div>
  );
}

