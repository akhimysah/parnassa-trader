import { useState, type ReactNode } from 'react';
import { useTerminal } from '../contexte';
import { DEFINITIONS } from '../graphique/indicateurs';
import { fermerPosition, profitPosition, supprimerOrdre, type Compte } from '../compte/moteur';
import { useMenuContextuel } from './ui';

function Noeud({ libelle, icone, children, ouvertParDefaut = false, onDoubleClick, onContextMenu, actif }: { libelle: ReactNode; icone: string; children?: ReactNode; ouvertParDefaut?: boolean; onDoubleClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void; actif?: boolean }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  return (
    <li>
      <div className={`noeud${actif ? ' actif' : ''}`} onDoubleClick={onDoubleClick ?? (() => setOuvert(!ouvert))} onContextMenu={onContextMenu}>
        <span className="noeud-bascule" onClick={() => setOuvert(!ouvert)}>
          {children ? (ouvert ? '⊟' : '⊞') : ''}
        </span>
        <span className="noeud-icone">{icone}</span>
        <span>{libelle}</span>
      </div>
      {children && ouvert && <ul>{children}</ul>}
    </li>
  );
}

/** Scripts livrés avec le terminal, comme les exemples de MT5. */
const SCRIPTS: { nom: string; executer: (c: Compte, cot: Parameters<typeof fermerPosition>[2]) => Compte }[] = [
  { nom: 'Fermer toutes les positions', executer: (c, cot) => c.positions.reduce((acc, p) => fermerPosition(acc, p.ticket, cot).compte, c) },
  { nom: 'Fermer les positions gagnantes', executer: (c, cot) => c.positions.filter((p) => profitPosition(p, cot) > 0).reduce((acc, p) => fermerPosition(acc, p.ticket, cot).compte, c) },
  { nom: 'Fermer les positions perdantes', executer: (c, cot) => c.positions.filter((p) => profitPosition(p, cot) < 0).reduce((acc, p) => fermerPosition(acc, p.ticket, cot).compte, c) },
  { nom: 'Supprimer tous les ordres en attente', executer: (c) => c.ordres.reduce((acc, o) => supprimerOrdre(acc, o.ticket).compte, c) },
];

export function Navigateur() {
  const { etat, maj, ouvrir, operer, cotations } = useTerminal();
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const groupes = ['Tendance', 'Oscillateurs', 'Volumes'] as const;
  return (
    <div className="panneau navigateur">
      <div className="panneau-titre">
        <span>Navigateur</span>
        <button onClick={() => maj((e) => ({ ...e, panneaux: { ...e.panneaux, navigateur: false } }))} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="panneau-corps">
        <ul className="arbre">
          <Noeud libelle="Parnassa Trader" icone="▣" ouvertParDefaut>
            <Noeud libelle="Comptes" icone="👤" ouvertParDefaut onContextMenu={(e) => { e.preventDefault(); ouvrirMenu(e.clientX, e.clientY, [{ libelle: 'Ouvrir un compte…', action: () => ouvrir({ type: 'compte' }) }]); }}>
              <Noeud libelle={etat.comptes[0]?.serveur ?? 'Parnassa-Demo'} icone="🖥" ouvertParDefaut>
                {etat.comptes.map((c) => (
                  <Noeud
                    key={c.login}
                    libelle={`${c.login} : ${c.nom}`}
                    icone={c.login === etat.actif ? '🟢' : '⚪'}
                    actif={c.login === etat.actif}
                    onDoubleClick={() => maj((e) => ({ ...e, actif: c.login }))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      ouvrirMenu(e.clientX, e.clientY, [
                        { libelle: 'Se connecter', action: () => maj((x) => ({ ...x, actif: c.login })) },
                        { libelle: 'Dépôt / retrait…', desactive: c.login !== etat.actif, action: () => ouvrir({ type: 'depot' }) },
                        { separateur: true },
                        { libelle: 'Ouvrir un compte…', action: () => ouvrir({ type: 'compte' }) },
                        {
                          libelle: 'Supprimer',
                          desactive: etat.comptes.length <= 1,
                          action: () => {
                            if (!window.confirm(`Supprimer le compte de démonstration ${c.login} et tout son historique ?`)) return;
                            maj((x) => {
                              const comptes = x.comptes.filter((k) => k.login !== c.login);
                              return { ...x, comptes, actif: x.actif === c.login ? comptes[0].login : x.actif };
                            });
                          },
                        },
                      ]);
                    }}
                  />
                ))}
              </Noeud>
            </Noeud>
            <Noeud libelle="Indicateurs" icone="ƒ" ouvertParDefaut>
              {groupes.map((gr) => (
                <Noeud key={gr} libelle={gr} icone="📁">
                  {DEFINITIONS.filter((d) => d.groupe === gr).map((d) => (
                    <Noeud key={d.type} libelle={d.nom} icone="ƒ" onDoubleClick={() => ouvrir({ type: 'indicateur', indicateur: d.type, graphique: etat.graphiqueActif })} />
                  ))}
                </Noeud>
              ))}
            </Noeud>
            <Noeud libelle="Expert Advisors" icone="🎓">
              <li className="noeud vide">Aucun conseiller expert installé</li>
            </Noeud>
            <Noeud libelle="Scripts" icone="📜" ouvertParDefaut>
              {SCRIPTS.map((sc) => (
                <Noeud
                  key={sc.nom}
                  libelle={sc.nom}
                  icone="▶"
                  onDoubleClick={() => {
                    if (!window.confirm(`Exécuter le script « ${sc.nom} » ?`)) return;
                    operer((c) => ({ compte: sc.executer(c, cotations), erreur: null }), { silencieux: true });
                  }}
                />
              ))}
            </Noeud>
          </Noeud>
        </ul>
      </div>
      {menu}
    </div>
  );
}
