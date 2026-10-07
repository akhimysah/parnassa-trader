import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------- Navigation : onglets + pile d'écrans, comme une application native ----------

export type Onglet = 'cotations' | 'graphique' | 'trade' | 'historique' | 'parametres';

export type Ecran =
  | { type: 'ordre'; symbole: string; attente?: boolean }
  | { type: 'resultat'; ok: boolean; titre: string; texte: string }
  | { type: 'position'; ticket: number }
  | { type: 'fermer'; ticket: number }
  | { type: 'ordre-attente'; ticket: number }
  | { type: 'symbole'; symbole: string }
  | { type: 'ajouter' }
  | { type: 'editer' }
  | { type: 'comptes' }
  | { type: 'ouvrir-compte' }
  | { type: 'liste'; quoi: 'courrier' | 'actualites' | 'calendrier' | 'journal' | 'alertes' };

export interface Action {
  libelle: string;
  action: () => void;
  danger?: boolean;
}

interface Nav {
  onglet: Onglet;
  changerOnglet: (o: Onglet) => void;
  pousser: (e: Ecran) => void;
  retour: () => void;
  /** Revient à la racine de l'onglet (après un ordre exécuté par exemple). */
  racine: (o?: Onglet) => void;
  feuille: (titre: string | null, actions: Action[]) => void;
}

export const ContexteNav = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(ContexteNav);
  if (!n) throw new Error('Navigation mobile absente');
  return n;
}

/** Petite vibration de confirmation (téléphones qui la prennent en charge). */
export function vibrer(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // non pris en charge
  }
}

// ---------- En-tête ----------

export function EnTete({ titre, sousTitre, gauche, droite, grand }: { titre: ReactNode; sousTitre?: ReactNode; gauche?: ReactNode; droite?: ReactNode; grand?: boolean }) {
  return (
    <header className={`mm-entete${grand ? ' grand' : ''}`}>
      <div className="mm-entete-cote">{gauche}</div>
      <div className="mm-entete-titre">
        <div className="mm-titre">{titre}</div>
        {sousTitre && <div className="mm-sous-titre">{sousTitre}</div>}
      </div>
      <div className="mm-entete-cote droite">{droite}</div>
    </header>
  );
}

export function BoutonRetour({ libelle = '' }: { libelle?: string }) {
  const { retour } = useNav();
  return (
    <button className="mm-bouton-entete" onClick={retour} aria-label="Retour">
      <svg viewBox="0 0 12 20" width="11" height="18">
        <path d="M10 2L2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {libelle && <span>{libelle}</span>}
    </button>
  );
}

export function BoutonIcone({ onClick, titre, children }: { onClick: () => void; titre: string; children: ReactNode }) {
  return (
    <button className="mm-bouton-entete" onClick={onClick} aria-label={titre} title={titre}>
      {children}
    </button>
  );
}

export const IconePlus = () => (
  <svg viewBox="0 0 20 20" width="20" height="20">
    <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// ---------- Feuille d'actions (menu du bas) ----------

export function FeuilleActions({ titre, actions, fermer }: { titre: string | null; actions: Action[]; fermer: () => void }) {
  return (
    <div className="mm-voile" onClick={fermer}>
      <div className="mm-feuille" onClick={(e) => e.stopPropagation()}>
        <div className="mm-feuille-groupe">
          {titre && <div className="mm-feuille-titre">{titre}</div>}
          {actions.map((a) => (
            <button
              key={a.libelle}
              className={a.danger ? 'danger' : ''}
              onClick={() => {
                fermer();
                a.action();
              }}
            >
              {a.libelle}
            </button>
          ))}
        </div>
        <div className="mm-feuille-groupe">
          <button className="annuler" onClick={fermer}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Appui long ----------

/** Appui long (500 ms) sur mobile, clic droit sur ordinateur ; un simple appui appelle `court`. */
export function useAppuiLong(long: () => void, court?: () => void) {
  const minuteur = useRef<number | undefined>(undefined);
  const declenche = useRef(false);
  const depart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => window.clearTimeout(minuteur.current), []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      declenche.current = false;
      depart.current = { x: e.clientX, y: e.clientY };
      minuteur.current = window.setTimeout(() => {
        declenche.current = true;
        vibrer(15);
        long();
      }, 500);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = depart.current;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) window.clearTimeout(minuteur.current);
    },
    onPointerUp: () => window.clearTimeout(minuteur.current),
    onPointerCancel: () => window.clearTimeout(minuteur.current),
    onClick: () => {
      if (!declenche.current) court?.();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      window.clearTimeout(minuteur.current);
      declenche.current = true;
      long();
    },
  };
}

// ---------- Contrôles ----------

export function Interrupteur({ actif, changer, libelle }: { actif: boolean; changer: (v: boolean) => void; libelle: string }) {
  return (
    <button className={`mm-interrupteur${actif ? ' actif' : ''}`} role="switch" aria-checked={actif} aria-label={libelle} onClick={() => changer(!actif)}>
      <span />
    </button>
  );
}

/** Champ numérique avec boutons − / + de part et d'autre, comme les champs de prix de MT5 mobile. */
export function ChampPas({
  valeur,
  changer,
  pas,
  decimales,
  min = 0,
  max = Infinity,
  vide = false,
  amorce,
  placeholder,
}: {
  valeur: number;
  changer: (v: number) => void;
  pas: number;
  decimales: number;
  min?: number;
  max?: number;
  vide?: boolean;
  amorce?: number;
  placeholder?: string;
}) {
  const [texte, setTexte] = useState(vide && valeur === 0 ? '' : valeur.toFixed(decimales));
  const focus = useRef(false);
  useEffect(() => {
    if (!focus.current) setTexte(vide && valeur === 0 ? '' : valeur.toFixed(decimales));
  }, [valeur, decimales, vide]);
  const borner = (v: number) => Number(Math.min(max, Math.max(min, v)).toFixed(decimales));
  const pousser = (sens: 1 | -1) => {
    vibrer(6);
    changer(borner(valeur === 0 && amorce ? amorce : valeur + sens * pas));
  };
  return (
    <div className="mm-champ-pas">
      <button type="button" onClick={() => pousser(-1)} aria-label="Diminuer">
        −
      </button>
      <input
        inputMode="decimal"
        value={texte}
        placeholder={placeholder}
        onFocus={() => (focus.current = true)}
        onBlur={() => {
          focus.current = false;
          setTexte(vide && valeur === 0 ? '' : valeur.toFixed(decimales));
        }}
        onChange={(e) => {
          setTexte(e.target.value);
          const v = Number(e.target.value.replace(',', '.').replace(/\s/g, ''));
          if (e.target.value.trim() === '' && vide) changer(0);
          else if (Number.isFinite(v)) changer(Math.min(max, Math.max(min, v)));
        }}
      />
      <button type="button" onClick={() => pousser(1)} aria-label="Augmenter">
        +
      </button>
    </div>
  );
}

/** Volume façon MT5 mobile : −0.5 −0.1 −0.01 | valeur | +0.01 +0.1 +0.5. */
export function ChampVolume({ valeur, changer, min, max, pasMin }: { valeur: number; changer: (v: number) => void; min: number; max: number; pasMin: number }) {
  const ajouter = (d: number) => {
    vibrer(6);
    changer(Number(Math.min(max, Math.max(min, Math.round((valeur + d) / pasMin) * pasMin)).toFixed(2)));
  };
  const pas = pasMin >= 1 ? [10, 5, 1] : [0.5, 0.1, 0.01];
  return (
    <div className="mm-volume">
      {pas.map((p) => (
        <button key={`-${p}`} onClick={() => ajouter(-p)}>
          −{p}
        </button>
      ))}
      <input
        inputMode="decimal"
        value={valeur.toFixed(2)}
        onChange={(e) => {
          const v = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(v) && v > 0) changer(Math.min(max, v));
        }}
      />
      {[...pas].reverse().map((p) => (
        <button key={`+${p}`} onClick={() => ajouter(p)}>
          +{p}
        </button>
      ))}
    </div>
  );
}

/** Contrôle segmenté iOS. */
export function Segments<T extends string>({ valeur, changer, options }: { valeur: T; changer: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="mm-segments">
      {options.map(([v, l]) => (
        <button key={v} className={valeur === v ? 'actif' : ''} onClick={() => changer(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------- Icônes de la barre d'onglets ----------

export const ICONES: Record<Onglet, ReactNode> = {
  cotations: (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M7 4v15M3.5 7.5L7 4l3.5 3.5M17 20V5M13.5 16.5L17 20l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  graphique: (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M6 3v18M18 3v18M12 6v12" stroke="currentColor" strokeWidth="1.4" />
      <rect x="4" y="7" width="4" height="8" rx="0.6" fill="currentColor" />
      <rect x="10" y="9" width="4" height="5" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="16" y="6" width="4" height="9" rx="0.6" fill="currentColor" />
    </svg>
  ),
  trade: (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <path d="M3 17l5-6 4 3 7-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6h4v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 21h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  historique: (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  parametres: (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.8l1.6 2.3 2.7-.6.8 2.6 2.6.8-.6 2.7 2.3 1.6-2.3 1.6.6 2.7-2.6.8-.8 2.6-2.7-.6L12 21.2l-1.6-2.3-2.7.6-.8-2.6-2.6-.8.6-2.7L2.8 12l2.3-1.6-.6-2.7 2.6-.8.8-2.6 2.7.6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
};
