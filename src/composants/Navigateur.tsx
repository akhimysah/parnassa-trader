import { useState, type ReactNode } from 'react';
import { actionsProprietaire } from './DialoguesComptes';
import { useTerminal } from '../contexte';
import { DEFINITIONS, GROUPES } from '../graphique/indicateurs';
import { EXPERTS } from '../algo/experts';
import { preparerTest } from './Testeur';
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
  const terminal = useTerminal();
  const { etat, maj, ouvrir, operer, cotations, enLigne } = terminal;
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const groupes = GROUPES;
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
              {[...new Set(etat.comptes.map((c) => c.serveur))].map((serveur) => (
                <Noeud key={serveur} libelle={serveur} icone="🖥" ouvertParDefaut>
                  {etat.comptes
                    .filter((c) => c.serveur === serveur)
                    .map((c) => {
                      const statut = c.enLigne ? enLigne.statut(c.login) : null;
                      const connecter = () => (statut === 'deconnecte' ? ouvrir({ type: 'connexion', login: c.login }) : maj((x) => ({ ...x, actif: c.login })));
                      return (
                        <Noeud
                          key={c.login}
                          libelle={`${c.login} : ${c.nom}${c.type === 'raw' ? ' (Raw)' : ''}${statut === 'deconnecte' ? ' — non connecté' : c.lecture ? ' — lecture seule' : ''}`}
                          icone={statut === 'deconnecte' ? '🔴' : c.login === etat.actif ? '🟢' : '⚪'}
                          actif={c.login === etat.actif}
                          onDoubleClick={connecter}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            ouvrirMenu(e.clientX, e.clientY, [
                              { libelle: 'Se connecter', action: connecter },
                              ...(c.enLigne && statut !== 'deconnecte' ? [{ libelle: 'Se déconnecter', action: () => void enLigne.deconnecter(c.login) }] : []),
                              { libelle: 'Dépôt / retrait…', desactive: c.login !== etat.actif, action: () => ouvrir({ type: 'depot' }) },
                              ...actionsProprietaire(c, terminal, (acces) => ouvrir({ type: 'acces', acces })).map((x) => ({ libelle: x.libelle, action: x.action })),
                              { separateur: true },
                              { libelle: 'Ouvrir un compte…', action: () => ouvrir({ type: 'compte' }) },
                              {
                                libelle: c.enLigne ? 'Retirer de cet appareil' : 'Supprimer',
                                desactive: etat.comptes.length <= 1,
                                action: () => {
                                  const question = c.enLigne
                                    ? `Retirer le compte ${c.login} de cet appareil ? Il reste sur le serveur ${c.serveur} : reconnectez-vous avec son mot de passe pour le retrouver.`
                                    : `Supprimer le compte de démonstration ${c.login} et tout son historique ?`;
                                  if (!window.confirm(question)) return;
                                  if (c.enLigne) void enLigne.deconnecter(c.login);
                                  maj((x) => {
                                    const comptes = x.comptes.filter((k) => k.login !== c.login);
                                    return { ...x, comptes, actif: x.actif === c.login ? comptes[0].login : x.actif };
                                  });
                                },
                              },
                            ]);
                          }}
                        />
                      );
                    })}
                </Noeud>
              ))}
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
            <Noeud libelle="Expert Advisors" icone="🎓" ouvertParDefaut>
              {EXPERTS.map((x) => (
                <Noeud
                  key={x.type}
                  libelle={x.nom}
                  icone="🎓"
                  onDoubleClick={() => ouvrir({ type: 'expert', graphique: etat.graphiqueActif, expert: x.type })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const g = etat.graphiques.find((k) => k.id === etat.graphiqueActif);
                    ouvrirMenu(e.clientX, e.clientY, [
                      { libelle: 'Attacher au graphique', action: () => ouvrir({ type: 'expert', graphique: etat.graphiqueActif, expert: x.type }) },
                      {
                        libelle: 'Tester',
                        raccourci: 'Ctrl+R',
                        action: () => {
                          maj((k) => ({ ...k, panneaux: { ...k.panneaux, testeur: true } }));
                          setTimeout(() => preparerTest({ expert: x.type, symbole: g?.symbole ?? 'EURUSD', periode: g?.periode ?? 'H1' }), 0);
                        },
                      },
                    ]);
                  }}
                />
              ))}
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
