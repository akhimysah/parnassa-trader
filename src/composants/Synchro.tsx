import { useTerminal } from '../contexte';
import { lienLiaison } from '../synchro';
import { Fenetre } from './ui';

/** Bloc « Compte Parnassa » : relier l'appareil, état de la synchronisation, déconnexion. */
export function BlocSynchro() {
  const { synchro } = useTerminal();
  if (synchro.statut === 'deconnecte') {
    return (
      <div className="bloc-synchro">
        <p>
          Reliez Parnassa Trader à votre <b>compte Parnassa</b> pour retrouver vos comptes de démonstration, positions, historique, graphiques, experts et alertes sur tous vos appareils.
        </p>
        <a className="bouton-lien principal" href={lienLiaison()}>
          Relier mon compte Parnassa
        </a>
        <p className="aide">Vous serez redirigé vers Parnassa pour vous connecter et autoriser l'application. Elle n'a accès à rien d'autre (ni solde, ni cartes, ni virements).</p>
      </div>
    );
  }
  const libelle = { 'a-jour': 'À jour', envoi: 'Envoi…', erreur: 'Erreur', connexion: 'Connexion…', deconnecte: '' }[synchro.statut];
  return (
    <div className="bloc-synchro">
      <p>
        {synchro.compte ? (
          <>
            Relié à <b>{synchro.compte.email}</b>
          </>
        ) : (
          'Connexion au compte Parnassa…'
        )}{' '}
        <span className={`etat-synchro ${synchro.statut}`}>{libelle}</span>
      </p>
      <p className="aide">
        {synchro.derniereSynchro ? `Dernière synchronisation : ${new Date(synchro.derniereSynchro).toLocaleTimeString('fr-FR')}. ` : ''}
        {synchro.erreur ?? ''}
      </p>
      <p className="aide">
        Les changements partent au plus toutes les 15 secondes ; ceux des autres appareils sont repris chaque minute et au retour sur l'application. L'Algo Trading et la disposition de l'écran restent propres à chaque appareil : activez les experts sur un seul appareil.
      </p>
      <div className="boutons gauche">
        <button onClick={synchro.synchroniser}>Synchroniser maintenant</button>
        <button
          onClick={() => {
            if (window.confirm('Déconnecter le compte Parnassa de cet appareil ? Vos données restent sur cet appareil et sur le compte.')) void synchro.deconnecter();
          }}
        >
          Déconnecter
        </button>
      </div>
    </div>
  );
}

export function DialogueSynchro() {
  const { fermer } = useTerminal();
  return (
    <Fenetre titre="Compte Parnassa · synchronisation" fermer={fermer} largeur={460}>
      <BlocSynchro />
      <div className="boutons">
        <button className="principal" onClick={fermer}>
          Fermer
        </button>
      </div>
    </Fenetre>
  );
}

/** Indicateur de la barre d'état (nuage), qui ouvre la fenêtre de synchronisation. */
export function IndicateurSynchro() {
  const { synchro, ouvrir } = useTerminal();
  const titre =
    synchro.statut === 'deconnecte'
      ? 'Non relié à un compte Parnassa : cliquez pour synchroniser vos appareils'
      : `Compte Parnassa${synchro.compte ? ` (${synchro.compte.email})` : ''} : ${synchro.statut === 'a-jour' ? 'à jour' : synchro.statut === 'envoi' ? 'envoi en cours' : synchro.statut === 'erreur' ? (synchro.erreur ?? 'erreur') : 'connexion'}`;
  return (
    <button className={`be-synchro ${synchro.statut}`} title={titre} onClick={() => ouvrir({ type: 'synchro' })}>
      <svg viewBox="0 0 20 14" width="18" height="13">
        <path d="M5 12h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 5.6 4.2 3.9 3.9 0 0 0 5 12z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        {synchro.statut === 'a-jour' && <path d="M7.5 8l2 2 3.5-4" fill="none" stroke="currentColor" strokeWidth="1.4" />}
        {synchro.statut === 'deconnecte' && <path d="M7 6l6 5M13 6l-6 5" stroke="currentColor" strokeWidth="1.2" />}
      </svg>
      {synchro.statut === 'deconnecte' ? 'Hors compte' : synchro.statut === 'a-jour' ? 'Synchronisé' : synchro.statut === 'envoi' ? 'Envoi…' : synchro.statut === 'erreur' ? 'Erreur' : 'Connexion…'}
    </button>
  );
}
