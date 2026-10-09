import { useEffect, useState } from 'react';
import { useTerminal } from '../contexte';
import { nouveauCompte, SERVEUR } from '../compte/moteur';
import { RELAIS } from '../marche/bougies';
import { TYPES_COMPTE, formaterPrix, symbole, type TypeCompte } from '../marche/symboles';
import { MESSAGES } from '../composants/BoiteOutils';
import { BlocSynchro } from '../composants/Synchro';
import { BlocAcces, DEPOTS, LEVIERS, LIBELLE_STATUT } from '../composants/DialoguesComptes';
import { SERVEUR_EN_LIGNE, type Acces } from '../compte/enLigne';
import { argent, dateMT } from '../composants/ui';
import { choisirInterface } from '../interface';
import { demanderPermission, notificationsDisponibles } from '../notifications';
import { useInstallation } from '../installation';
import { BoutonIcone, BoutonRetour, ChampPas, EnTete, IconePlus, Interrupteur, Segments, useAppuiLong, useNav, vibrer } from './commun';

/** Onglet Paramètres : compte, messagerie, outils et réglages, comme le menu de MT5 mobile. */
export function Reglages() {
  const { etat, maj, compte, ouvrir, synchro, signaler, enLigne } = useTerminal();
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
              {compte.enLigne && (
                <span className={`pastille-statut ${enLigne.statut(compte.login)}`}>
                  {compte.lecture && enLigne.statut(compte.login) === 'connecte' ? 'lecture seule' : LIBELLE_STATUT[enLigne.statut(compte.login)]}
                </span>
              )}
            </small>
            <small>
              {argent(compte.solde)} USD · 1:{compte.levier} · démo {TYPES_COMPTE[compte.type ?? 'standard'].nom}
              {compte.sansSwap ? ' sans swap' : ''}
            </small>
          </span>
          <span className="mm-chevron">›</span>
        </button>

        <ul className="mm-liste">
          <li className="fleche" onClick={() => pousser({ type: 'connexion' })}>
            <span className="mm-ico bleu">⇥</span>Se connecter à un compte
          </li>
        </ul>

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
            <Interrupteur actif={etat.unClicAccepte} libelle="Trading en un clic" changer={(v) => (v ? pousser({ type: 'unclic' }) : maj((e) => ({ ...e, unClicAccepte: false })))} />
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
          <li className="mm-li-colonne">
            <span className="mm-li-titre">
              <span className="mm-ico gris">🌙</span>Thème
            </span>
            <Segments<'clair' | 'sombre' | 'auto'>
              valeur={etat.themeAuto ? 'auto' : etat.theme}
              changer={(v) => maj((e) => (v === 'auto' ? { ...e, themeAuto: true } : { ...e, themeAuto: false, theme: v }))}
              options={[
                ['clair', 'Clair'],
                ['sombre', 'Sombre'],
                ['auto', 'Automatique'],
              ]}
            />
          </li>
          <li>
            <span className="mm-ico orange">☀</span>Garder l'écran allumé
            <Interrupteur actif={etat.ecranAllume} libelle="Garder l'écran allumé" changer={(v) => maj((e) => ({ ...e, ecranAllume: v }))} />
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

/** Liste des comptes par serveur : changer de compte, se connecter à un compte en ligne, en ouvrir un. */
export function Comptes() {
  const { etat, maj, enLigne } = useTerminal();
  const { pousser, feuille } = useNav();
  const serveurs = [...new Set(etat.comptes.map((c) => c.serveur))];
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
        {serveurs.map((serveur) => (
          <div key={serveur}>
            <div className="mm-section">{serveur}</div>
            <ul className="mm-liste">
              {etat.comptes
                .filter((c) => c.serveur === serveur)
                .map((c) => {
                  const statut = c.enLigne ? enLigne.statut(c.login) : null;
                  const connecter = () => {
                    vibrer();
                    if (statut === 'deconnecte') pousser({ type: 'connexion', login: c.login });
                    else maj((e) => ({ ...e, actif: c.login }));
                  };
                  return (
                    <LigneCompte
                      key={c.login}
                      actif={c.login === etat.actif}
                      titre={c.nom}
                      statut={statut ? (c.lecture && statut === 'connecte' ? 'lecture seule' : LIBELLE_STATUT[statut]) : null}
                      classeStatut={statut ?? ''}
                      detail={`${c.login} · ${TYPES_COMPTE[c.type ?? 'standard'].nom} · 1:${c.levier} · ${argent(c.solde)} USD`}
                      choisir={connecter}
                      menu={() =>
                        feuille(`${c.login} — ${c.nom}`, [
                          { libelle: 'Se connecter', action: connecter },
                          ...(c.enLigne && statut !== 'deconnecte' ? [{ libelle: 'Se déconnecter', action: () => void enLigne.deconnecter(c.login) }] : []),
                          ...(c.login === etat.actif ? [{ libelle: 'Dépôt / retrait', action: () => pousser({ type: 'depot' }) }] : []),
                          ...(etat.comptes.length > 1
                            ? [
                                {
                                  libelle: c.enLigne ? 'Retirer de cet appareil' : 'Supprimer le compte',
                                  danger: true,
                                  action: () => {
                                    const question = c.enLigne
                                      ? `Retirer le compte ${c.login} de cet appareil ? Il reste sur ${c.serveur} : reconnectez-vous avec son mot de passe pour le retrouver.`
                                      : `Supprimer le compte de démonstration ${c.login} et tout son historique ?`;
                                    if (!window.confirm(question)) return;
                                    if (c.enLigne) void enLigne.deconnecter(c.login);
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
                  );
                })}
            </ul>
          </div>
        ))}
        <ul className="mm-liste">
          <li className="fleche" onClick={() => pousser({ type: 'connexion' })}>
            <span className="mm-ico bleu">⇥</span>Se connecter à un compte existant
          </li>
          <li className="fleche" onClick={() => pousser({ type: 'ouvrir-compte' })}>
            <span className="mm-ico vert">＋</span>Ouvrir un compte de démonstration
          </li>
        </ul>
        <div className="mm-section">Compte Parnassa · synchronisation</div>
        <div className="mm-bloc">
          <BlocSynchro />
        </div>
      </div>
    </div>
  );
}

function LigneCompte({ actif, titre, detail, statut, classeStatut, choisir, menu }: { actif: boolean; titre: string; detail: string; statut: string | null; classeStatut: string; choisir: () => void; menu: () => void }) {
  const appui = useAppuiLong(menu, choisir);
  return (
    <li {...appui}>
      <span className={`mm-coche ${actif ? 'actif' : ''}`}>{actif ? '✓' : ''}</span>
      <div className="mm-liste-texte">
        <b>
          {titre}
          {statut && <span className={`pastille-statut ${classeStatut}`}>{statut}</span>}
        </b>
        <small>{detail}</small>
      </div>
    </li>
  );
}

/** Connexion à un compte comme sur MT5 mobile : numéro, mot de passe, serveur. */
export function ConnexionCompte({ login: loginInitial }: { login?: number }) {
  const { etat, maj, enLigne, signaler } = useTerminal();
  const { racine, pousser } = useNav();
  const [login, setLogin] = useState(loginInitial ? String(loginInitial) : '');
  const [motDePasse, setMotDePasse] = useState('');
  const [voir, setVoir] = useState(false);
  const [attente, setAttente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    if (!/^9\d{7}$/.test(login)) return setErreur('Numéro de compte invalide : 8 chiffres commençant par 9.');
    if (!motDePasse) return setErreur('Saisissez le mot de passe du compte.');
    setAttente(true);
    setErreur(null);
    try {
      const c = await enLigne.connecter(Number(login), motDePasse, SERVEUR_EN_LIGNE);
      maj((e) => ({ ...e, actif: c.login }));
      signaler(`${c.login} : connecté${c.lecture ? ' en lecture seule' : ''}`);
      vibrer(20);
      racine();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Connexion impossible.');
      setAttente(false);
    }
  };
  const locaux = etat.comptes.filter((c) => !c.enLigne);
  return (
    <div className="mm-ecran">
      <EnTete titre="Connexion" gauche={<BoutonRetour />} />
      <form
        className="mm-defile"
        onSubmit={(e) => {
          e.preventDefault();
          void valider();
        }}
      >
        <div className="mm-serveur-carte">
          <span className="mm-ico violet">P</span>
          <div>
            <b>{SERVEUR_EN_LIGNE}</b>
            <small>Parnassa · comptes de démonstration en ligne</small>
          </div>
        </div>
        <div className="mm-formulaire">
          <label className="mm-ligne-champ">
            <span>Compte</span>
            <input value={login} inputMode="numeric" autoComplete="username" placeholder="9xxxxxxx" autoFocus={!loginInitial} onChange={(e) => setLogin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
          </label>
          <label className="mm-ligne-champ">
            <span>Mot de passe</span>
            <input type={voir ? 'text' : 'password'} value={motDePasse} autoComplete="current-password" autoFocus={Boolean(loginInitial)} onChange={(e) => setMotDePasse(e.target.value)} />
          </label>
          <div className="mm-ligne-champ">
            <span>Afficher</span>
            <span style={{ justifySelf: 'end' }}>
              <Interrupteur actif={voir} libelle="Afficher le mot de passe" changer={setVoir} />
            </span>
          </div>
        </div>
        {erreur && <p className="mm-erreur-champ">{erreur}</p>}
        <p className="mm-note">Le mot de passe investisseur ouvre le compte en lecture seule. Pas encore de compte ? Ouvrez-en un : ses accès vous seront donnés une fois.</p>
        <div className="mm-boutons-bas">
          <button type="submit" className="mm-bouton principal" disabled={attente}>
            {attente ? 'CONNEXION…' : 'SE CONNECTER'}
          </button>
          <button type="button" className="mm-bouton" onClick={() => pousser({ type: 'ouvrir-compte' })}>
            Ouvrir un compte démo
          </button>
        </div>
        {locaux.length > 0 && (
          <>
            <div className="mm-section">{SERVEUR} · comptes de cet appareil</div>
            <ul className="mm-liste">
              {locaux.map((c) => (
                <li
                  key={c.login}
                  className="fleche"
                  onClick={() => {
                    maj((e) => ({ ...e, actif: c.login }));
                    racine();
                  }}
                >
                  <div className="mm-liste-texte">
                    <b>{c.nom}</b>
                    <small>
                      {c.login} · {argent(c.solde)} USD
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </form>
    </div>
  );
}

export function OuvrirCompte() {
  const { maj, signaler, enLigne } = useTerminal();
  const { retour, pousser } = useNav();
  const [nom, setNom] = useState('Compte démo');
  const [depot, setDepot] = useState(10000);
  const [levier, setLevier] = useState(100);
  const [type, setType] = useState<TypeCompte>('standard');
  const [sansSwap, setSansSwap] = useState(false);
  const [surServeur, setSurServeur] = useState(true);
  const [attente, setAttente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    const n = nom.trim() || 'Compte démo';
    if (!surServeur) {
      const c = nouveauCompte(n, depot, levier, type, sansSwap);
      maj((e) => ({ ...e, comptes: [...e.comptes, c], actif: c.login }));
      signaler(`Compte ${c.login} ouvert`);
      vibrer(20);
      retour();
      return;
    }
    setAttente(true);
    setErreur(null);
    try {
      const acces = await enLigne.ouvrir({ nom: n, depot, levier, type, sansSwap });
      maj((e) => ({ ...e, actif: acces.login }));
      vibrer(20);
      pousser({ type: 'acces', acces });
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Ouverture impossible.');
      setAttente(false);
    }
  };
  return (
    <div className="mm-ecran">
      <EnTete titre="Compte démo" gauche={<BoutonRetour />} />
      <div className="mm-defile">
        <div className="mm-formulaire">
          <div className="mm-ligne-champ">
            <span>Serveur</span>
            <span style={{ justifySelf: 'end' }}>
              <Segments
                valeur={surServeur ? 'ligne' : 'local'}
                options={[
                  ['ligne', 'En ligne'],
                  ['local', 'Cet appareil'],
                ]}
                changer={(v) => setSurServeur(v === 'ligne')}
              />
            </span>
          </div>
          <div className="mm-aide-ligne">
            {surServeur
              ? `${SERVEUR_EN_LIGNE} : numéro et mot de passe pour vous connecter depuis n'importe quel appareil.`
              : `${SERVEUR} : compte gardé sur cet appareil (ou synchronisé par votre compte Parnassa).`}
          </div>
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
              {DEPOTS.map((v) => (
                <option key={v} value={v}>
                  {argent(v, 0)} USD
                </option>
              ))}
            </select>
          </label>
          <label className="mm-ligne-champ">
            <span>Levier</span>
            <select value={levier} onChange={(e) => setLevier(Number(e.target.value))}>
              {LEVIERS.map((v) => (
                <option key={v} value={v}>
                  1:{v}
                </option>
              ))}
            </select>
          </label>
        </div>
        {erreur && <p className="mm-erreur-champ">{erreur}</p>}
        <p className="mm-note">Argent fictif, aucune donnée personnelle demandée.</p>
      </div>
      <div className="mm-boutons-bas">
        <button className="mm-bouton principal" disabled={attente} onClick={() => void valider()}>
          {attente ? 'OUVERTURE…' : 'OUVRIR LE COMPTE'}
        </button>
      </div>
    </div>
  );
}

/** Accès du compte ouvert, montrés une seule fois. */
export function AccesCompte({ acces }: { acces: Acces }) {
  const { racine } = useNav();
  const [copie, setCopie] = useState(false);
  const texte = `Compte : ${acces.login}\nServeur : ${acces.serveur}\nMot de passe : ${acces.motDePasse}\nMot de passe investisseur (lecture seule) : ${acces.motDePasseInvestisseur}`;
  return (
    <div className="mm-ecran">
      <EnTete titre="Compte ouvert" />
      <div className="mm-defile">
        <div className="mm-bloc">
          <BlocAcces acces={acces} />
        </div>
        <p className="mm-note fort">Notez ces accès maintenant : le mot de passe ne sera plus jamais affiché. Ils servent à vous connecter à ce compte sur un autre appareil.</p>
      </div>
      <div className="mm-boutons-bas">
        <button
          className="mm-bouton"
          onClick={() => {
            const partage = navigator.share ? navigator.share({ title: `Compte ${acces.login}`, text: texte }) : navigator.clipboard.writeText(texte).then(() => setCopie(true));
            void partage.catch(() => undefined);
          }}
        >
          {copie ? 'Copié ✓' : 'Copier / partager les accès'}
        </button>
        <button className="mm-bouton principal" onClick={() => racine()}>
          J'AI NOTÉ
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
