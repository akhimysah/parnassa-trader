import { useEffect, useState } from 'react';
import { useTerminal, type Terminal } from '../contexte';
import { TYPES_COMPTE, type TypeCompte } from '../marche/symboles';
import { nouveauCompte, SERVEUR, type Compte } from '../compte/moteur';
import { SERVEUR_EN_LIGNE, type Acces, type CompteServeur, type StatutCompte } from '../compte/enLigne';

import { Fenetre, argent } from './ui';

export const DEPOTS = [500, 1000, 3000, 5000, 10000, 25000, 50000, 100000, 500000, 1000000];
export const LEVIERS = [1, 2, 5, 10, 20, 30, 50, 100, 200, 300, 400, 500, 1000];

export const LIBELLE_STATUT: Record<StatutCompte, string> = { connecte: 'connecté', connexion: 'connexion…', deconnecte: 'non connecté', erreur: 'serveur injoignable' };

/** Ouverture d'un compte de démonstration, en ligne (accès par numéro et mot de passe) ou dans ce navigateur. */
export function DialogueCompte() {
  const { maj, fermer, signaler, ouvrir, enLigne } = useTerminal();
  const [nom, setNom] = useState('Compte démo');
  const [depot, setDepot] = useState(10000);
  const [levier, setLevier] = useState(100);
  const [type, setType] = useState<TypeCompte>('standard');
  const [sansSwap, setSansSwap] = useState(false);
  const [mode, setMode] = useState<'couverture' | 'netting'>('couverture');
  const [devise, setDevise] = useState<'USD' | 'EUR'>('USD');
  const [surServeur, setSurServeur] = useState(true);
  const [attente, setAttente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    const n = nom.trim() || 'Compte démo';
    if (!surServeur) {
      const c = nouveauCompte(n, depot, levier, type, sansSwap, mode, devise);
      maj((e) => ({ ...e, comptes: [...e.comptes, c], actif: c.login }));
      signaler(`Compte ${TYPES_COMPTE[type].nom} ${c.login} ouvert sur ${SERVEUR}`);
      fermer();
      return;
    }
    setAttente(true);
    setErreur(null);
    try {
      const acces = await enLigne.ouvrir({ nom: n, depot, levier, type, sansSwap, mode, devise });
      maj((e) => ({ ...e, actif: acces.login }));
      ouvrir({ type: 'acces', acces });
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Ouverture impossible.');
      setAttente(false);
    }
  };
  return (
    <Fenetre titre="Ouvrir un compte de démonstration" fermer={fermer} largeur={460}>
      <div className="choix-serveur">
        <label className={surServeur ? 'actif' : ''}>
          <input type="radio" checked={surServeur} onChange={() => setSurServeur(true)} />
          <span>
            <b>{SERVEUR_EN_LIGNE}</b> — compte en ligne
            <small>Numéro, mot de passe et serveur, comme chez un courtier : vous vous connectez depuis n'importe quel appareil.</small>
          </span>
        </label>
        <label className={!surServeur ? 'actif' : ''}>
          <input type="radio" checked={!surServeur} onChange={() => setSurServeur(false)} />
          <span>
            <b>{SERVEUR}</b> — compte local
            <small>Conservé dans ce navigateur seulement (ou synchronisé par votre compte Parnassa).</small>
          </span>
        </label>
      </div>
      <div className="formulaire">
        <label>
          <span>Nom du compte :</span>
          <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={40} />
        </label>
        <label>
          <span>Type de compte :</span>
          <select value={type} onChange={(e) => setType(e.target.value as TypeCompte)}>
            {(Object.keys(TYPES_COMPTE) as TypeCompte[]).map((t) => (
              <option key={t} value={t}>
                {TYPES_COMPTE[t].nom} — {TYPES_COMPTE[t].description}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Devise du dépôt :</span>
          <select value={devise} onChange={(e) => setDevise(e.target.value as 'USD' | 'EUR')}>
            <option value="USD">USD — dollar américain</option>
            <option value="EUR">EUR — euro</option>
          </select>
        </label>
        <label>
          <span>Mode :</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'couverture' | 'netting')}>
            <option value="couverture">Couverture (hedging) — plusieurs positions par symbole</option>
            <option value="netting">Compensation (netting) — une position par symbole</option>
          </select>
        </label>
        <label className="case">
          <input type="checkbox" checked={sansSwap} onChange={() => setSansSwap(!sansSwap)} />
          Compte sans swap (islamique)
        </label>
        <label>
          <span>Dépôt :</span>
          <select value={depot} onChange={(e) => setDepot(Number(e.target.value))}>
            {DEPOTS.map((v) => (
              <option key={v} value={v}>
                {argent(v, 0)} {devise}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Levier :</span>
          <select value={levier} onChange={(e) => setLevier(Number(e.target.value))}>
            {LEVIERS.map((v) => (
              <option key={v} value={v}>
                1:{v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {erreur && <p className="erreur-champ">{erreur}</p>}
      <p className="aide">Argent fictif. Profits, marges et swaps sont convertis dans la devise du dépôt. Aucune donnée personnelle n'est demandée.</p>
      <div className="boutons">
        <button onClick={fermer}>Annuler</button>
        <button className="principal" disabled={attente} onClick={() => void valider()}>
          {attente ? 'Ouverture…' : 'Ouvrir'}
        </button>
      </div>
    </Fenetre>
  );
}

/** Accès du compte, montrés une seule fois comme le fait un courtier à l'ouverture. */
export function DialogueAcces({ acces }: { acces: Acces }) {
  const { fermer } = useTerminal();
  const [copie, setCopie] = useState(false);
  const texte = `Compte : ${acces.login}\nServeur : ${acces.serveur}\nMot de passe : ${acces.motDePasse}\nMot de passe investisseur (lecture seule) : ${acces.motDePasseInvestisseur}`;
  return (
    <Fenetre titre={`Accès du compte ${acces.login}`} fermer={fermer} largeur={420}>
      <BlocAcces acces={acces} />
      <p className="avertissement">Notez ces accès maintenant : le mot de passe ne sera plus jamais affiché. Ils servent à vous connecter à ce compte sur un autre appareil.</p>
      <div className="boutons">
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(texte)
              .then(() => setCopie(true))
              .catch(() => undefined)
          }
        >
          {copie ? 'Copié ✓' : 'Copier les accès'}
        </button>
        <button className="principal" onClick={fermer} autoFocus>
          J'ai noté
        </button>
      </div>
    </Fenetre>
  );
}

export function BlocAcces({ acces }: { acces: Acces }) {
  return (
    <dl className="acces-compte">
      <dt>Compte</dt>
      <dd>{acces.login}</dd>
      <dt>Serveur</dt>
      <dd>{acces.serveur}</dd>
      <dt>Mot de passe</dt>
      <dd>
        <code>{acces.motDePasse}</code>
      </dd>
      <dt>Investisseur</dt>
      <dd>
        <code>{acces.motDePasseInvestisseur}</code> <small>(lecture seule)</small>
      </dd>
    </dl>
  );
}

/** Fenêtre « Se connecter à un compte de trading » de MT5 : numéro, mot de passe, serveur ; comptes connus en dessous. */
export function DialogueConnexion({ login: loginInitial }: { login?: number }) {
  const { etat, maj, fermer, ouvrir, enLigne, signaler } = useTerminal();
  const [login, setLogin] = useState(loginInitial ? String(loginInitial) : '');
  const [motDePasse, setMotDePasse] = useState('');
  const [serveur, setServeur] = useState(SERVEUR_EN_LIGNE);
  const [attente, setAttente] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = async () => {
    const n = Number(login.trim());
    if (serveur === SERVEUR) {
      const local = etat.comptes.find((c) => c.login === n && !c.enLigne);
      if (!local) return setErreur(`Compte ${login} introuvable sur ${SERVEUR} : les comptes locaux n'existent que dans le navigateur qui les a ouverts.`);
      maj((e) => ({ ...e, actif: n }));
      fermer();
      return;
    }
    if (!/^9\d{7}$/.test(login.trim())) return setErreur('Numéro de compte invalide : 8 chiffres commençant par 9.');
    if (!motDePasse) return setErreur('Saisissez le mot de passe du compte.');
    setAttente(true);
    setErreur(null);
    try {
      const c = await enLigne.connecter(n, motDePasse, serveur);
      maj((e) => ({ ...e, actif: n }));
      signaler(`${n} : connecté à ${serveur}${c.lecture ? ' en lecture seule' : ''}`);
      fermer();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Connexion impossible.');
      setAttente(false);
    }
  };
  return (
    <Fenetre titre="Se connecter à un compte de trading" fermer={fermer} largeur={440}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void valider();
        }}
      >
        <div className="formulaire">
          <label>
            <span>Compte :</span>
            <input value={login} onChange={(e) => setLogin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="username" autoFocus={!loginInitial} list="logins-connus" />
            <datalist id="logins-connus">
              {etat.comptes.map((c) => (
                <option key={c.login} value={c.login}>
                  {c.nom}
                </option>
              ))}
            </datalist>
          </label>
          {serveur === SERVEUR_EN_LIGNE && (
            <label>
              <span>Mot de passe :</span>
              <input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} autoComplete="current-password" autoFocus={Boolean(loginInitial)} />
            </label>
          )}
          <label>
            <span>Serveur :</span>
            <select value={serveur} onChange={(e) => setServeur(e.target.value)}>
              <option value={SERVEUR_EN_LIGNE}>{SERVEUR_EN_LIGNE} — comptes en ligne</option>
              <option value={SERVEUR}>{SERVEUR} — comptes locaux</option>
            </select>
          </label>
        </div>
        {serveur === SERVEUR_EN_LIGNE && <p className="aide">Le mot de passe investisseur ouvre le compte en lecture seule.</p>}
        {erreur && <p className="erreur-champ">{erreur}</p>}
        <div className="boutons">
          <button type="button" onClick={() => ouvrir({ type: 'compte' })}>
            Ouvrir un compte…
          </button>
          <button type="button" onClick={fermer}>
            Annuler
          </button>
          <button type="submit" className="principal" disabled={attente}>
            {attente ? 'Connexion…' : 'Connexion'}
          </button>
        </div>
      </form>
      <MesComptesEnLigne
        apres={(login) => {
          maj((e) => ({ ...e, actif: login }));
          fermer();
        }}
      />
      {etat.comptes.length > 0 && (
        <>
          <h4 className="titre-section">Comptes de cet appareil</h4>
          <div className="liste-comptes">
            {etat.comptes.map((c) => {
              const statut = c.enLigne ? enLigne.statut(c.login) : null;
              return (
                <button
                  key={c.login}
                  className={c.login === etat.actif ? 'actif' : ''}
                  onClick={() => {
                    if (statut === 'deconnecte') {
                      setLogin(String(c.login));
                      setServeur(SERVEUR_EN_LIGNE);
                      setErreur(null);
                      return;
                    }
                    maj((e) => ({ ...e, actif: c.login }));
                    fermer();
                  }}
                >
                  <b>
                    {c.login} — {c.nom}
                    {statut && <span className={`pastille-statut ${statut}`}>{c.lecture && statut === 'connecte' ? 'lecture seule' : LIBELLE_STATUT[statut]}</span>}
                  </b>
                  <small>
                    {c.serveur} · {TYPES_COMPTE[c.type ?? 'standard'].nom} · 1:{c.levier} · solde {argent(c.solde)} {c.devise}
                  </small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Fenetre>
  );
}

/** Comptes en ligne du compte Parnassa relié : connexion en un geste, sans mot de passe. */
export function useMesComptes() {
  const { enLigne, synchro } = useTerminal();
  const relie = synchro.statut !== 'deconnecte';
  const [comptes, setComptes] = useState<CompteServeur[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    if (!relie) return;
    let actif = true;
    enLigne
      .mesComptes()
      .then((c) => actif && setComptes(c))
      .catch((e: unknown) => actif && setErreur(e instanceof Error ? e.message : 'Liste indisponible.'));
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relie]);
  return { relie, comptes, erreur };
}

function MesComptesEnLigne({ apres }: { apres: (login: number) => void }) {
  const { etat, enLigne, signaler } = useTerminal();
  const { relie, comptes, erreur } = useMesComptes();
  const [enCours, setEnCours] = useState<number | null>(null);
  if (!relie) return null;
  return (
    <>
      <h4 className="titre-section">Vos comptes {SERVEUR_EN_LIGNE} (compte Parnassa relié)</h4>
      {erreur && <p className="erreur-champ">{erreur}</p>}
      {!comptes && !erreur && <p className="aide">Chargement…</p>}
      {comptes?.length === 0 && <p className="aide">Aucun compte en ligne pour l'instant : ouvrez-en un, il sera rattaché à votre compte Parnassa.</p>}
      <div className="liste-comptes">
        {comptes?.map((c) => {
          const connecte = etat.comptes.some((k) => k.login === c.login && enLigne.statut(c.login) !== 'deconnecte');
          return (
            <button
              key={c.login}
              disabled={enCours !== null}
              onClick={() => {
                if (connecte) return apres(c.login);
                setEnCours(c.login);
                enLigne
                  .connecterProprietaire(c.login)
                  .then(() => {
                    signaler(`${c.login} : connecté à ${SERVEUR_EN_LIGNE}`);
                    apres(c.login);
                  })
                  .catch((e: unknown) => {
                    signaler(e instanceof Error ? e.message : 'Connexion impossible.');
                    setEnCours(null);
                  });
              }}
            >
              <b>
                {c.login} — {c.nom}
                <span className={`pastille-statut ${connecte ? 'connecte' : ''}`}>{enCours === c.login ? 'connexion…' : connecte ? 'sur cet appareil' : 'se connecter'}</span>
              </b>
              <small>
                {SERVEUR_EN_LIGNE} · solde {argent(c.resume?.balance ?? c.capital)} USD · {c.resume?.positions ?? 0} position(s)
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * Gestion d'un compte en ligne par son propriétaire (compte Parnassa relié) : renommer, nouveaux mots de passe,
 * fermeture. Partagé par le Navigateur (bureau) et la liste des comptes (mobile).
 */
export function actionsProprietaire(
  c: Compte,
  t: Pick<Terminal, 'etat' | 'maj' | 'enLigne' | 'synchro' | 'signaler'>,
  montrerAcces: (a: Acces) => void,
): { libelle: string; action: () => void; danger?: boolean }[] {
  if (!c.enLigne || t.synchro.statut === 'deconnecte') return [];
  const echec = (e: unknown) => t.signaler(e instanceof Error ? e.message : 'Opération impossible.');
  return [
    {
      libelle: 'Renommer le compte…',
      action: () => {
        const nom = window.prompt('Nouveau nom du compte', c.nom)?.trim();
        if (!nom || nom === c.nom) return;
        t.enLigne
          .renommer(c.login, nom)
          .then(() => t.maj((e) => ({ ...e, comptes: e.comptes.map((k) => (k.login === c.login ? { ...k, nom } : k)) })))
          .catch(echec);
      },
    },
    {
      libelle: 'Changer les mots de passe…',
      action: () => {
        if (!window.confirm(`Nouveaux mots de passe pour le compte ${c.login} ? Les anciens ne marcheront plus et le compte sera déconnecté de tous les autres appareils.`)) return;
        t.enLigne.nouveauxMotsDePasse(c.login).then(montrerAcces).catch(echec);
      },
    },
    {
      libelle: 'Fermer le compte…',
      danger: true,
      action: () => {
        if (t.etat.comptes.length <= 1) return t.signaler('Ouvrez d’abord un autre compte : il en faut au moins un.');
        if (!window.confirm(`Fermer définitivement le compte ${c.login} sur ${c.serveur} ? Ses accès ne marcheront plus et son historique en ligne sera effacé.`)) return;
        t.enLigne
          .fermerCompte(c.login)
          .then(() => {
            t.maj((e) => {
              const comptes = e.comptes.filter((k) => k.login !== c.login);
              return { ...e, comptes, actif: e.actif === c.login ? comptes[0].login : e.actif };
            });
            t.signaler(`Compte ${c.login} fermé`);
          })
          .catch(echec);
      },
    },
  ];
}
