import { useEffect, useState } from 'react';
import { useTerminal } from '../contexte';
import { nouveauCompte, SERVEUR } from '../compte/moteur';
import { RELAIS } from '../marche/bougies';
import { TYPES_COMPTE, formaterPrix, symbole, type TypeCompte } from '../marche/symboles';
import { MESSAGES } from '../composants/BoiteOutils';
import { BlocSynchro } from '../composants/Synchro';
import { argent, dateMT } from '../composants/ui';
import { choisirInterface } from '../interface';
import { demanderPermission, notificationsDisponibles } from '../notifications';
import { useInstallation } from '../installation';
import { BoutonIcone, BoutonRetour, ChampPas, EnTete, IconePlus, Interrupteur, Segments, useAppuiLong, useNav, vibrer } from './commun';

/** Onglet Paramètres : compte, messagerie, outils et réglages, comme le menu de MT5 mobile. */
export function Reglages() {
  const { etat, maj, compte, ouvrir, synchro, signaler } = useTerminal();
  const { pousser, feuille } = useNav();
  const installation = useInstallation();
  const notifications = async (v: boolean) => {
    if (!v) return maj((e) => ({ ...e, notifications: false }));
    const ok = await demanderPermission();
    if (ok) {
      maj((e) => ({ ...e, notifications: true }));
      signaler('Notifications activées : exécutions, SL/TP, stop-out et alertes');
    } else signaler('Notifications refusées par le navigateur : autorisez-les dans les réglages du site');
  };
  const nonLus = MESSAGES.filter((m) => !etat.lus.includes(m.id)).length;
  return (
    <div className="mm-ecran">
      <EnTete titre="Paramètres" />
      <div className="mm-defile">
        <button className="mm-carte-compte" onClick={() => pousser({ type: 'comptes' })}>
          <span className="mm-avatar">{compte.nom.slice(0, 1).toUpperCase()}</span>
          <span className="mm-carte-texte">
            <b>{compte.nom}</b>
            <small>
              {compte.login} — {compte.serveur}
            </small>
            <small>
              {argent(compte.solde)} USD · 1:{compte.levier} · démo {TYPES_COMPTE[compte.type ?? 'standard'].nom}
              {compte.sansSwap ? ' sans swap' : ''}
            </small>
          </span>
          <span className="mm-chevron">›</span>
        </button>

        <div className="mm-section">Messages</div>
        <ul className="mm-liste">
          <li className="fleche" onClick={() => pousser({ type: 'liste', quoi: 'courrier' })}>
            <span className="mm-ico bleu">✉</span>Boîte aux lettres
            {nonLus > 0 && <span className="mm-pastille">{nonLus}</span>}
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'liste', quoi: 'actualites' })}>
            <span className="mm-ico orange">📰</span>Actualités
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'liste', quoi: 'calendrier' })}>
            <span className="mm-ico rouge">📅</span>Calendrier économique
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'liste', quoi: 'alertes' })}>
            <span className="mm-ico violet">🔔</span>Alertes
            {etat.alertes.filter((a) => a.active).length > 0 && <small className="mm-compte">{etat.alertes.filter((a) => a.active).length}</small>}
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'liste', quoi: 'journal' })}>
            <span className="mm-ico gris">📜</span>Journal
          </li>
        </ul>

        <div className="mm-section">Trading</div>
        <ul className="mm-liste">
          <li>
            <span className="mm-ico vert">⚡</span>Trading en un clic
            <Interrupteur actif={etat.unClicAccepte} libelle="Trading en un clic" changer={(v) => (v ? ouvrir({ type: 'unclic' }) : maj((e) => ({ ...e, unClicAccepte: false })))} />
          </li>
          <li>
            <span className="mm-ico bleu">🎓</span>Algo Trading
            <Interrupteur actif={etat.algo} libelle="Algo Trading" changer={(v) => maj((e) => ({ ...e, algo: v }))} />
          </li>
          <li>
            <span className="mm-ico gris">⚖</span>Volume par défaut
            <span className="mm-champ-court">
              <ChampPas valeur={etat.volumeDefaut} changer={(v) => maj((e) => ({ ...e, volumeDefaut: v }))} pas={0.01} min={0.01} max={100} decimales={2} />
            </span>
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'experts' })}>
            <span className="mm-ico bleu">🎓</span>Expert Advisors
            <small className="mm-compte">{etat.graphiques.filter((g) => g.expert).length || ''}</small>
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'rapport' })}>
            <span className="mm-ico violet">📊</span>Rapport de trading
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'depot' })}>
            <span className="mm-ico vert">$</span>Dépôt / retrait
          </li>
          {notificationsDisponibles() && (
            <li>
              <span className="mm-ico rouge">🔔</span>Notifications
              <Interrupteur actif={etat.notifications} libelle="Notifications" changer={(v) => void notifications(v)} />
            </li>
          )}
        </ul>

        <div className="mm-section">Affichage</div>
        <ul className="mm-liste">
          <li>
            <span className="mm-ico gris">🌙</span>Thème sombre
            <Interrupteur actif={etat.theme === 'sombre'} libelle="Thème sombre" changer={(v) => maj((e) => ({ ...e, theme: v ? 'sombre' : 'clair' }))} />
          </li>
          <li>
            <span className="mm-ico bleu">⇅</span>Cotations avancées
            <Interrupteur actif={etat.mobileAvance} libelle="Cotations avancées" changer={(v) => maj((e) => ({ ...e, mobileAvance: v }))} />
          </li>
          <li>
            <span className="mm-ico orange">🔊</span>Sons
            <Interrupteur actif={etat.son} libelle="Sons" changer={(v) => maj((e) => ({ ...e, son: v }))} />
          </li>
          {installation.etat !== 'installee' && installation.etat !== 'indisponible' && (
            <li
              className="fleche"
              onClick={() =>
                installation.etat === 'invite'
                  ? void installation.installer()
                  : feuille("Installer sur l'iPhone", [{ libelle: 'Touchez Partager ⬆︎ puis « Sur l’écran d’accueil »', action: () => undefined }])
              }
            >
              <span className="mm-ico bleu">⬇</span>Installer l'application
            </li>
          )}
          <li className="fleche" onClick={() => choisirInterface('bureau')}>
            <span className="mm-ico gris">🖥</span>Version ordinateur
          </li>
        </ul>

        <div className="mm-section">Compte Parnassa</div>
        <ul className="mm-liste">
          <li className="fleche" onClick={() => ouvrir({ type: 'synchro' })}>
            <span className="mm-ico violet">☁</span>Synchronisation
            <small className="mm-compte">{synchro.statut === 'deconnecte' ? 'désactivée' : synchro.statut === 'a-jour' ? 'à jour' : synchro.statut}</small>
          </li>
          <li className="fleche" onClick={() => ouvrir({ type: 'apropos' })}>
            <span className="mm-ico gris">ℹ</span>À propos
          </li>
        </ul>
        <p className="mm-note">Parnassa Trader · comptes de démonstration uniquement, cotations réelles.</p>
      </div>
    </div>
  );
}

/** Liste des comptes : changer de compte, en ouvrir un, synchroniser. */
export function Comptes() {
  const { etat, maj } = useTerminal();
  const { pousser, feuille } = useNav();
  return (
    <div className="mm-ecran">
      <EnTete
        titre="Comptes"
        gauche={<BoutonRetour />}
        droite={
          <BoutonIcone titre="Ouvrir un compte" onClick={() => pousser({ type: 'ouvrir-compte' })}>
            <IconePlus />
          </BoutonIcone>
        }
      />
      <div className="mm-defile">
        <div className="mm-section">{SERVEUR}</div>
        <ul className="mm-liste">
          {etat.comptes.map((c) => (
            <LigneCompte
              key={c.login}
              actif={c.login === etat.actif}
              titre={c.nom}
              detail={`${c.login} · ${TYPES_COMPTE[c.type ?? 'standard'].nom} · 1:${c.levier} · ${argent(c.solde)} USD`}
              choisir={() => {
                vibrer();
                maj((e) => ({ ...e, actif: c.login }));
              }}
              menu={() =>
                feuille(`${c.login} — ${c.nom}`, [
                  { libelle: 'Se connecter', action: () => maj((e) => ({ ...e, actif: c.login })) },
                  ...(c.login === etat.actif ? [{ libelle: 'Dépôt / retrait', action: () => pousser({ type: 'depot' }) }] : []),
                  ...(etat.comptes.length > 1
                    ? [
                        {
                          libelle: 'Supprimer le compte',
                          danger: true,
                          action: () => {
                            if (!window.confirm(`Supprimer le compte de démonstration ${c.login} et tout son historique ?`)) return;
                            maj((e) => {
                              const comptes = e.comptes.filter((k) => k.login !== c.login);
                              return { ...e, comptes, actif: e.actif === c.login ? comptes[0].login : e.actif };
                            });
                          },
                        },
                      ]
                    : []),
                ])
              }
            />
          ))}
        </ul>
        <div className="mm-section">Compte Parnassa · synchronisation</div>
        <div className="mm-bloc">
          <BlocSynchro />
        </div>
      </div>
    </div>
  );
}

function LigneCompte({ actif, titre, detail, choisir, menu }: { actif: boolean; titre: string; detail: string; choisir: () => void; menu: () => void }) {
  const appui = useAppuiLong(menu, choisir);
  return (
    <li {...appui}>
      <span className={`mm-coche ${actif ? 'actif' : ''}`}>{actif ? '✓' : ''}</span>
      <div className="mm-liste-texte">
        <b>{titre}</b>
        <small>{detail}</small>
      </div>
    </li>
  );
}

export function OuvrirCompte() {
  const { maj, signaler } = useTerminal();
  const { retour } = useNav();
  const [nom, setNom] = useState('Compte démo');
  const [depot, setDepot] = useState(10000);
  const [levier, setLevier] = useState(100);
  const [type, setType] = useState<TypeCompte>('standard');
  const [sansSwap, setSansSwap] = useState(false);
  return (
    <div className="mm-ecran">
      <EnTete titre="Compte démo" gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <p className="mm-note">Ouverture d'un compte de démonstration sur le serveur {SERVEUR}. Aucune donnée personnelle n'est demandée.</p>
        <div className="mm-formulaire">
          <label className="mm-ligne-champ">
            <span>Nom</span>
            <input value={nom} maxLength={40} onChange={(e) => setNom(e.target.value)} />
          </label>
          <label className="mm-ligne-champ">
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as TypeCompte)}>
              {(Object.keys(TYPES_COMPTE) as TypeCompte[]).map((t) => (
                <option key={t} value={t}>
                  {TYPES_COMPTE[t].nom}
                </option>
              ))}
            </select>
          </label>
          <div className="mm-aide-ligne">{TYPES_COMPTE[type].description}</div>
          <div className="mm-ligne-champ">
            <span>Sans swap</span>
            <span style={{ justifySelf: 'end' }}>
              <Interrupteur actif={sansSwap} libelle="Compte sans swap" changer={setSansSwap} />
            </span>
          </div>
          <label className="mm-ligne-champ">
            <span>Dépôt</span>
            <select value={depot} onChange={(e) => setDepot(Number(e.target.value))}>
              {[500, 1000, 3000, 5000, 10000, 25000, 50000, 100000, 500000, 1000000].map((v) => (
                <option key={v} value={v}>
                  {argent(v, 0)} USD
                </option>
              ))}
            </select>
          </label>
          <label className="mm-ligne-champ">
            <span>Levier</span>
            <select value={levier} onChange={(e) => setLevier(Number(e.target.value))}>
              {[1, 2, 5, 10, 20, 30, 50, 100, 200, 300, 400, 500, 1000].map((v) => (
                <option key={v} value={v}>
                  1:{v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton principal"
          onClick={() => {
            const c = nouveauCompte(nom.trim() || 'Compte démo', depot, levier, type, sansSwap);
            maj((e) => ({ ...e, comptes: [...e.comptes, c], actif: c.login }));
            signaler(`Compte ${c.login} ouvert`);
            vibrer(20);
            retour();
          }}
        >
          OUVRIR LE COMPTE
        </button>
      </div>
    </div>
  );
}

// ---------- Listes : boîte aux lettres, actualités, calendrier, alertes, journal ----------

const TITRES = { courrier: 'Boîte aux lettres', actualites: 'Actualités', calendrier: 'Calendrier économique', journal: 'Journal', alertes: 'Alertes' };

export function EcranListe({ quoi }: { quoi: keyof typeof TITRES }) {
  const { pousser } = useNav();
  return (
    <div className="mm-ecran">
      <EnTete
        titre={TITRES[quoi]}
        gauche={<BoutonRetour />}
        droite={
          quoi === 'alertes' ? (
            <BoutonIcone titre="Créer une alerte" onClick={() => pousser({ type: 'alerte' })}>
              <IconePlus />
            </BoutonIcone>
          ) : undefined
        }
      />
      <div className="mm-defile">
        {quoi === 'courrier' && <Courrier />}
        {quoi === 'actualites' && <Actualites />}
        {quoi === 'calendrier' && <Calendrier />}
        {quoi === 'journal' && <Journal />}
        {quoi === 'alertes' && <Alertes />}
      </div>
    </div>
  );
}

function Courrier() {
  const { etat, maj } = useTerminal();
  const [ouvert, setOuvert] = useState<string | null>(null);
  return (
    <ul className="mm-liste mm-messages">
      {MESSAGES.map((m) => (
        <li
          key={m.id}
          className={etat.lus.includes(m.id) ? '' : 'non-lu'}
          onClick={() => {
            setOuvert(ouvert === m.id ? null : m.id);
            if (!etat.lus.includes(m.id)) maj((e) => ({ ...e, lus: [...e.lus, m.id] }));
          }}
        >
          <div className="mm-liste-texte">
            <b>{m.titre}</b>
            <small>
              {m.de} · {dateMT(m.date, false)}
            </small>
            {ouvert === m.id && <p className="mm-message-texte">{m.texte}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface Depeche {
  id: string;
  titre: string;
  titreFr?: string;
  lien: string;
  source: string;
  date: number;
  important: boolean;
}

function Actualites() {
  const [liste, setListe] = useState<Depeche[] | null>(null);
  useEffect(() => {
    let actif = true;
    const charger = () =>
      fetch(`${RELAIS}/flux`)
        .then((r) => r.json() as Promise<{ depeches: Depeche[] }>)
        .then((d) => actif && setListe(d.depeches.slice(0, 150)))
        .catch(() => actif && setListe([]));
    void charger();
    const t = window.setInterval(charger, 60000);
    return () => {
      actif = false;
      window.clearInterval(t);
    };
  }, []);
  if (!liste) return <div className="mm-vide">Chargement…</div>;
  return (
    <ul className="mm-liste mm-messages">
      {liste.map((d) => (
        <li key={d.id} className={d.important ? 'important' : ''} onClick={() => window.open(d.lien, '_blank', 'noopener')}>
          <div className="mm-liste-texte">
            <b>{d.titreFr ?? d.titre}</b>
            <small>
              {d.source} · {dateMT(d.date, false)}
            </small>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface Evenement {
  id: string;
  titre: string;
  titreFr?: string;
  devise: string;
  date: number;
  importance: number;
  actuel: number | null;
  prevision: number | null;
  precedent: number | null;
  unite: string;
  echelle: string;
}

const DEVISES_CAL = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY'];

function Calendrier() {
  const [liste, setListe] = useState<Evenement[] | null>(null);
  const [importance, setImportance] = useState<'toutes' | 'moyenne' | 'haute'>('moyenne');
  const [devises, setDevises] = useState<string[]>([]);
  useEffect(() => {
    fetch(`${RELAIS}/calendrier`)
      .then((r) => r.json() as Promise<{ evenements: Evenement[] }>)
      .then((d) => setListe(d.evenements))
      .catch(() => setListe([]));
  }, []);
  // À l'ouverture, la liste se place sur le prochain événement (les jours passés restent au-dessus).
  useEffect(() => {
    if (liste) requestAnimationFrame(() => document.querySelector('.mm-calendrier li.prochain')?.scrollIntoView({ block: 'center' }));
  }, [liste]);
  if (!liste) return <div className="mm-vide">Chargement…</div>;
  const v = (x: number | null, e: Evenement) => (x === null ? '—' : `${x}${e.echelle}${e.unite}`);
  const seuil = importance === 'haute' ? 1 : importance === 'moyenne' ? 0 : -9;
  const filtres = liste.filter((e) => e.importance >= seuil && (devises.length === 0 || devises.includes(e.devise)));
  // Regroupement par jour, comme le calendrier de MT5 mobile.
  const jours = new Map<string, Evenement[]>();
  for (const e of filtres) {
    const j = new Date(e.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    jours.set(j, [...(jours.get(j) ?? []), e]);
  }
  const prochain = filtres.find((e) => e.date > Date.now());
  return (
    <>
      <div className="mm-segments-cadre">
        <Segments<'toutes' | 'moyenne' | 'haute'>
          valeur={importance}
          changer={setImportance}
          options={[
            ['toutes', 'Toutes'],
            ['moyenne', 'Moyenne +'],
            ['haute', 'Haute'],
          ]}
        />
      </div>
      <div className="mm-puces">
        {DEVISES_CAL.map((d) => (
          <button key={d} className={devises.includes(d) ? 'actif' : ''} onClick={() => setDevises((x) => (x.includes(d) ? x.filter((k) => k !== d) : [...x, d]))}>
            {d}
          </button>
        ))}
      </div>
      {[...jours.entries()].map(([jour, evs]) => (
        <div key={jour}>
          <div className="mm-section">{jour}</div>
          <ul className="mm-liste mm-calendrier">
            {evs.map((e) => (
              <li key={e.id} className={`${e.date < Date.now() ? 'passe' : ''}${prochain?.id === e.id ? ' prochain' : ''}`}>
                <span className={`mm-impact i${e.importance}`} />
                <div className="mm-liste-texte">
                  <b>
                    {new Date(e.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {e.devise} · {e.titreFr ?? e.titre}
                  </b>
                  <small>
                    actuel <b className={e.actuel !== null && e.prevision !== null ? (e.actuel >= e.prevision ? 'positif' : 'negatif') : ''}>{v(e.actuel, e)}</b> · prévision {v(e.prevision, e)} · précédent {v(e.precedent, e)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {filtres.length === 0 && <div className="mm-vide grand">Aucun événement pour ces filtres.</div>}
    </>
  );
}

function Journal() {
  const { compte } = useTerminal();
  return (
    <ul className="mm-liste mm-journal">
      {compte.journal
        .slice(-300)
        .reverse()
        .map((j, i) => (
          <li key={i} className={/échec/.test(j.message) ? 'erreur' : ''}>
            <div className="mm-liste-texte">
              <small>
                {dateMT(j.heure)} · {j.source}
              </small>
              <span>{j.message}</span>
            </div>
          </li>
        ))}
    </ul>
  );
}

function Alertes() {
  const { etat, maj, cotations } = useTerminal();
  const { feuille, pousser } = useNav();
  if (etat.alertes.length === 0) return <div className="mm-vide grand">Aucune alerte. Touchez + pour en créer une.</div>;
  return (
    <ul className="mm-liste">
      {etat.alertes.map((a) => {
        const s = symbole(a.symbole);
        const c = cotations[a.symbole];
        return (
          <li
            key={a.id}
            className={a.active ? '' : 'muet'}
            onClick={() =>
              feuille(`${a.symbole} ${a.condition.slice(0, 3).toUpperCase()} ${a.condition.slice(3)} ${formaterPrix(s, a.valeur)}`, [
                { libelle: 'Modifier', action: () => pousser({ type: 'alerte', id: a.id }) },
                { libelle: a.active ? 'Désactiver' : 'Réactiver', action: () => maj((e) => ({ ...e, alertes: e.alertes.map((x) => (x.id === a.id ? { ...x, active: !x.active, declencheeLe: undefined } : x)) })) },
                { libelle: 'Supprimer', danger: true, action: () => maj((e) => ({ ...e, alertes: e.alertes.filter((x) => x.id !== a.id) })) },
              ])
            }
          >
            <div className="mm-liste-texte">
              <b>
                {a.symbole} · {a.condition.slice(0, 3).toUpperCase()} {a.condition.slice(3)} {formaterPrix(s, a.valeur)}
              </b>
              <small>
                {a.declencheeLe ? `déclenchée le ${dateMT(a.declencheeLe)}` : a.active ? `actuel ${c ? formaterPrix(s, a.condition.startsWith('bid') ? c.bid : c.ask) : '—'}` : 'désactivée'}
                {a.commentaire ? ` · ${a.commentaire}` : ''}
              </small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
