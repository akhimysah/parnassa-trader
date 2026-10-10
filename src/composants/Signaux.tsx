import { useCallback, useEffect, useState } from 'react';
import { useTerminal } from '../contexte';
import { sessionCompte } from '../compte/enLigne';
import type { Abonnement, StatistiquesSignal } from '../compte/signaux';
import { SERVEUR_TRADER } from '../notifications';
import { Spin, argent, dateMT } from './ui';

interface SignalPublic {
  login: number;
  nom: string;
  description: string;
  publieLe: number;
  abonnes: number;
  stats: StatistiquesSignal;
}

async function appel<T>(chemin: string, corps?: unknown): Promise<T> {
  const r = await fetch(`${SERVEUR_TRADER}${chemin}`, corps === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  const d = (await r.json().catch(() => ({}))) as T & { erreur?: string };
  if (!r.ok || d.erreur) throw new Error(d.erreur ?? `serveur ${r.status}`);
  return d;
}

/** Petite courbe de solde d'un signal. */
function MiniCourbe({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="muet">—</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const d = points.map((v, k) => `${k ? 'L' : 'M'}${((k / (points.length - 1)) * 80).toFixed(1)},${(18 - ((v - min) / (max - min || 1)) * 16).toFixed(1)}`).join(' ');
  return (
    <svg width="80" height="20" className="mini-courbe" aria-hidden>
      <path d={d} fill="none" stroke={points[points.length - 1] >= points[0] ? 'var(--positif)' : 'var(--negatif)'} strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Signaux, comme l'onglet Signals de MT5 : les comptes en ligne publient leur trading, les autres le copient avec un
 * coefficient de volume. Le serveur Parnassa-Trader recopie les nouvelles positions chaque minute, terminaux fermés.
 */
export function OngletSignaux() {
  const { compte, signaler } = useTerminal();
  const [liste, setListe] = useState<SignalPublic[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [abonnement, setAbonnement] = useState<Abonnement | null>(null);
  const [copie, setCopie] = useState<{ login: number; ratio: number } | null>(null);
  const [publication, setPublication] = useState<{ nom: string; description: string } | null>(null);
  const session = compte.enLigne ? sessionCompte(compte.login) : null;
  const peutAgir = !!session && !session.lecture;

  const charger = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([appel<{ signaux: SignalPublic[] }>('/signaux'), compte.enLigne ? appel<{ abonnement: Abonnement | null }>(`/signaux/abonnement?login=${compte.login}`) : Promise.resolve({ abonnement: null })]);
      setListe(l.signaux);
      setAbonnement(a.abonnement);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'serveur injoignable');
    }
  }, [compte.login, compte.enLigne]);
  useEffect(() => {
    void charger();
    const t = window.setInterval(() => void charger(), 60000);
    return () => window.clearInterval(t);
  }, [charger]);

  const agir = async (chemin: string, extra: Record<string, unknown>, message: string) => {
    if (!session) return;
    try {
      await appel(chemin, { login: compte.login, jeton: session.jeton, ...extra });
      signaler(message);
      setCopie(null);
      setPublication(null);
      await charger();
    } catch (e) {
      signaler(e instanceof Error ? e.message : 'Échec');
    }
  };
  const monSignal = liste?.find((x) => x.login === compte.login);
  const suivi = abonnement ? liste?.find((x) => x.login === abonnement.fournisseur) : undefined;

  return (
    <div className="onglet-signaux">
      <div className="signaux-entete">
        {!compte.enLigne ? (
          <span className="muet">Les signaux se publient et se copient avec un compte en ligne Parnassa-Trader (Fichier → Ouvrir un compte en ligne). Vous pouvez consulter la liste ci-dessous.</span>
        ) : !peutAgir ? (
          <span className="muet">Compte {compte.login} connecté en lecture seule (mot de passe investisseur) : ni publication ni copie.</span>
        ) : abonnement ? (
          <span>
            {compte.login} copie <b>{suivi?.nom ?? abonnement.fournisseur}</b> (coefficient ×{abonnement.ratio}) depuis le {dateMT(abonnement.depuis)}.{' '}
            <button className="lien" onClick={() => void agir('/signaux/desabonner', {}, 'Copie du signal arrêtée')}>
              Arrêter la copie
            </button>
          </span>
        ) : monSignal ? (
          <span>
            {compte.login} publie le signal <b>{monSignal.nom}</b> ({monSignal.abonnes} abonné{monSignal.abonnes > 1 ? 's' : ''}).{' '}
            <button className="lien" onClick={() => setPublication({ nom: monSignal.nom, description: monSignal.description })}>
              Modifier
            </button>{' '}
            ·{' '}
            <button className="lien" onClick={() => window.confirm('Retirer votre signal ? Ses abonnés cesseront de le copier.') && void agir('/signaux/retirer', {}, 'Signal retiré')}>
              Retirer
            </button>
          </span>
        ) : (
          <span>
            <button onClick={() => setPublication({ nom: compte.nom, description: '' })}>Publier le signal de {compte.login}</button> <span className="muet">ou copiez un signal de la liste.</span>
          </span>
        )}
        <button className="lien" onClick={() => void charger()} title="Actualiser">
          ⟳
        </button>
      </div>
      {publication && (
        <div className="signaux-formulaire">
          <input value={publication.nom} maxLength={40} placeholder="Nom du signal" onChange={(e) => setPublication({ ...publication, nom: e.target.value })} />
          <input value={publication.description} maxLength={300} placeholder="Description (stratégie, symboles, style)" onChange={(e) => setPublication({ ...publication, description: e.target.value })} />
          <button className="principal" onClick={() => void agir('/signaux/publier', publication, 'Signal publié : vos nouvelles positions seront copiées par vos abonnés')}>
            Publier
          </button>
          <button onClick={() => setPublication(null)}>Annuler</button>
        </div>
      )}
      {erreur && <p className="negatif">Signaux indisponibles : {erreur}</p>}
      <table className="table boite-table">
        <thead>
          <tr>
            <th>Signal</th>
            <th>Compte</th>
            <th className="d">Croissance</th>
            <th>Courbe</th>
            <th className="d">Trades</th>
            <th className="d">Gagnants</th>
            <th className="d">DD max</th>
            <th className="d">Abonnés</th>
            <th className="d">Semaines</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(liste ?? []).map((x) => (
            <tr key={x.login} title={x.description || undefined}>
              <td>
                <b>{x.nom}</b>
                {x.description && <div className="muet signaux-description">{x.description}</div>}
              </td>
              <td>{x.login}</td>
              <td className={`d gras ${x.stats.croissancePct >= 0 ? 'positif' : 'negatif'}`}>{x.stats.croissancePct.toFixed(2)} %</td>
              <td>
                <MiniCourbe points={x.stats.courbe} />
              </td>
              <td className="d">{x.stats.trades}</td>
              <td className="d">{x.stats.gagnantsPct.toFixed(1)} %</td>
              <td className="d">{x.stats.ddMaxPct.toFixed(2)} %</td>
              <td className="d">{x.abonnes}</td>
              <td className="d">{x.stats.semaines}</td>
              <td>
                {peutAgir && x.login !== compte.login && !monSignal && abonnement?.fournisseur !== x.login && (
                  <button onClick={() => setCopie({ login: x.login, ratio: 1 })}>Copier…</button>
                )}
                {abonnement?.fournisseur === x.login && <span className="positif">copié</span>}
              </td>
            </tr>
          ))}
          {liste && liste.length === 0 && (
            <tr>
              <td colSpan={10} className="muet">
                Aucun signal publié pour l'instant.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {copie && (
        <div className="signaux-formulaire">
          <span>
            Copier le signal {copie.login} sur {compte.login}, volume ×
          </span>
          <Spin valeur={copie.ratio} changer={(v) => setCopie({ ...copie, ratio: v })} pas={0.1} min={0.1} max={10} decimales={1} />
          <button className="principal" onClick={() => void agir('/signaux/abonner', { fournisseur: copie.login, ratio: copie.ratio }, `Copie du signal ${copie.login} activée : ses nouvelles positions seront recopiées chaque minute`)}>
            Copier
          </button>
          <button onClick={() => setCopie(null)}>Annuler</button>
          <span className="muet">Seules les positions ouvertes à partir de maintenant sont copiées, avec leurs S/L et T/P ; elles se ferment avec l'original. Solde {argent(compte.solde)} {compte.devise}.</span>
        </div>
      )}
    </div>
  );
}
