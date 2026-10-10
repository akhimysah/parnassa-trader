import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../contexte';
import { identifiant } from '../etat';
import { compiler, EXEMPLE_SCRIPT, verifierScript } from '../algo/script';
import { FONCTIONS } from '../graphique/formule';
import { preparerTest } from './Testeur';
import { Fenetre } from './ui';

const AIDE: [string, string][] = [
  ['input nom = 10 // libellé', "Entrée de l'expert : modifiable à l'attache et optimisable dans le testeur"],
  ['nom = expression', 'Variable : une série calculée sur toutes les barres'],
  ['if condition then action; action', 'Vérifiée à la clôture de chaque barre'],
  ['buy · sell', "Ouvre une position (une seule par sens et par expert)"],
  ['close buy · close sell · close all', "Ferme les positions de l'expert"],
  ['open high low close volume median typical', 'Séries de prix'],
  ['hour · dayofweek · position', 'Heure (locale), jour (0 = lundi), position de l’expert (1, -1 ou 0)'],
  ['+ - * / < > <= >= == != and or not', 'Opérateurs (vrai = 1, faux = 0)'],
];

/**
 * MetaEditor (F4) : écrire un Expert Advisor en MQL Parnassa, le compiler (F7), puis l'attacher ou le tester.
 * Les experts sont rangés avec ceux de l'assistant dans le Navigateur.
 */
export function DialogueMetaEditeur({ id }: { id?: string }) {
  const { etat, maj, fermer, signaler, ouvrir } = useTerminal();
  const existant = etat.expertsPerso.find((e) => e.id === id && e.script !== undefined);
  const [nom, setNom] = useState(existant?.nom ?? 'Mon expert MQL');
  const [code, setCode] = useState(existant?.script ?? EXEMPLE_SCRIPT);
  const [sortie, setSortie] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enregistre, setEnregistre] = useState(existant?.script ?? null);
  const [ident] = useState(existant?.id ?? identifiant());
  const zone = useRef<HTMLTextAreaElement>(null);
  const gouttiere = useRef<HTMLDivElement>(null);
  const lignes = code.split('\n').length;
  const ligneErreur = sortie && !sortie.ok ? Number(/^ligne (\d+)/.exec(sortie.texte)?.[1] ?? 0) : 0;

  const compilerCode = (): boolean => {
    const erreur = verifierScript(code);
    if (erreur) {
      setSortie({ ok: false, texte: erreur });
      return false;
    }
    const { entrees } = compiler(code);
    setSortie({ ok: true, texte: `0 erreur — ${entrees.length} entrée(s) : ${entrees.map((e) => `${e.nom} = ${e.defaut}`).join(', ') || 'aucune'}` });
    return true;
  };
  const enregistrer = (): boolean => {
    if (!nom.trim()) {
      setSortie({ ok: false, texte: "Donnez un nom à l'expert." });
      return false;
    }
    if (!compilerCode()) return false;
    const e = { id: ident, nom: nom.trim().slice(0, 40), achat: [], vente: [], sortieAchat: [], sortieVente: [], script: code };
    maj((x) => ({ ...x, expertsPerso: x.expertsPerso.some((k) => k.id === ident) ? x.expertsPerso.map((k) => (k.id === ident ? e : k)) : [...x.expertsPerso, e] }));
    setEnregistre(code);
    signaler(`Expert « ${e.nom} » compilé et enregistré`);
    return true;
  };
  const quitter = () => {
    if (enregistre !== code && !window.confirm('Fermer le MetaEditor sans enregistrer les modifications ?')) return;
    fermer();
  };
  const g = etat.graphiques.find((x) => x.id === etat.graphiqueActif);

  useEffect(() => {
    const t = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        compilerCode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        enregistrer();
      }
    };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  });

  const allerLigne = (n: number) => {
    const z = zone.current;
    if (!z || n < 1) return;
    const debut = code.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0);
    z.focus();
    z.setSelectionRange(debut, debut + (code.split('\n')[n - 1]?.length ?? 0));
    z.scrollTop = Math.max(0, (n - 4) * 18);
  };

  return (
    <Fenetre titre={`MetaEditor — ${nom || 'sans nom'}.mqp${enregistre !== code ? ' *' : ''}`} fermer={quitter} largeur={940} className="fenetre-metaediteur">
      <div className="formulaire metaediteur-entete">
        <label>
          <span>Nom de l'expert :</span>
          <input value={nom} maxLength={40} onChange={(e) => setNom(e.target.value)} />
        </label>
        <div className="boutons gauche">
          <button onClick={() => compilerCode()} title="Compiler (F7)">
            ⚙ Compiler
          </button>
          <button className="principal" onClick={() => enregistrer()} title="Enregistrer (Ctrl+S)">
            💾 Enregistrer
          </button>
          <button
            onClick={() => {
              if (!enregistrer()) return;
              maj((k) => ({ ...k, panneaux: { ...k.panneaux, testeur: true } }));
              setTimeout(() => preparerTest({ expert: `perso:${ident}`, symbole: g?.symbole ?? 'EURUSD', periode: g?.periode ?? 'H1' }), 0);
              fermer();
            }}
          >
            ▶ Tester
          </button>
          <button
            disabled={!g}
            onClick={() => {
              if (!g || !enregistrer()) return;
              ouvrir({ type: 'expert', graphique: g.id, expert: `perso:${ident}` });
            }}
          >
            Attacher au graphique
          </button>
        </div>
      </div>
      <div className="metaediteur">
        <div className="metaediteur-code">
          <div className="metaediteur-gouttiere" ref={gouttiere} aria-hidden>
            {Array.from({ length: lignes }, (_, k) => (
              <div key={k} className={k + 1 === ligneErreur ? 'erreur' : ''}>
                {k + 1}
              </div>
            ))}
          </div>
          <textarea
            ref={zone}
            value={code}
            spellCheck={false}
            aria-label="Code MQL Parnassa"
            onChange={(e) => setCode(e.target.value)}
            onScroll={(e) => gouttiere.current && (gouttiere.current.scrollTop = e.currentTarget.scrollTop)}
            onKeyDown={(e) => {
              if (e.key !== 'Tab') return;
              e.preventDefault();
              const z = e.currentTarget;
              const [a, b] = [z.selectionStart, z.selectionEnd];
              setCode(code.slice(0, a) + '  ' + code.slice(b));
              requestAnimationFrame(() => z.setSelectionRange(a + 2, a + 2));
            }}
          />
        </div>
        <aside className="metaediteur-aide">
          <b>MQL Parnassa</b>
          <dl>
            {AIDE.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <b>Fonctions</b>
          <dl>
            {Object.entries(FONCTIONS).map(([k, v]) => (
              <div key={k}>
                <dt>{v.split(' — ')[0]}</dt>
                <dd>{v.split(' — ')[1] ?? ''}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
      <div className={`metaediteur-sortie ${sortie ? (sortie.ok ? 'positif' : 'negatif') : ''}`} onClick={() => ligneErreur && allerLigne(ligneErreur)} title={ligneErreur ? 'Aller à la ligne' : undefined}>
        {sortie ? (sortie.ok ? `✔ ${sortie.texte}` : `✖ ${sortie.texte}`) : 'Erreurs : compilez avec F7 pour vérifier le code.'}
      </div>
    </Fenetre>
  );
}
