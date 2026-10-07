import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SymboleMT } from '../marche/symboles';

/** Montant au format MT5 : espace pour les milliers, point décimal (« 10 000.00 »). */
export function argent(v: number, decimales = 2): string {
  const [ent, dec] = Math.abs(v).toFixed(decimales).split('.');
  const groupes = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 && Number(Math.abs(v).toFixed(decimales)) !== 0 ? '-' : ''}${groupes}${dec ? `.${dec}` : ''}`;
}

const z = (n: number, l = 2) => String(n).padStart(l, '0');

/** Date au format du terminal : « 2026.10.07 13:45:12 » (heure locale). */
export function dateMT(ms: number, secondes = true): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${z(d.getMonth() + 1)}.${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}${secondes ? `:${z(d.getSeconds())}` : ''}`;
}

export function heureMT(ms: number): string {
  const d = new Date(ms);
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

/** Prix affiché à la manière des panneaux de trading MT5 : les deux chiffres du pip en grand, le dixième de pip en exposant. */
export function PrixGros({ s, prix }: { s: SymboleMT | undefined; prix: number | undefined }) {
  if (prix === undefined || !s) return <span className="prix-gros">—</span>;
  const texte = prix.toFixed(s.chiffres);
  const fractionnaire = s.chiffres === 5 || s.chiffres === 3;
  const fin = fractionnaire ? texte.slice(-1) : '';
  const reste = fractionnaire ? texte.slice(0, -1) : texte;
  let gros = '';
  let petit = reste;
  // Les deux derniers chiffres (hors point) passent en grand.
  let n = 0;
  for (let i = reste.length - 1; i >= 0 && n < 2; i--) {
    gros = reste[i] + gros;
    if (reste[i] !== '.') n++;
    petit = reste.slice(0, i);
  }
  return (
    <span className="prix-gros">
      <span className="pg-petit">{petit}</span>
      <span className="pg-grand">{gros}</span>
      {fin && <sup className="pg-sup">{fin}</sup>}
    </span>
  );
}

// ---------- Menus ----------

export interface ElementMenu {
  libelle?: string;
  raccourci?: string;
  action?: () => void;
  sousMenu?: ElementMenu[];
  separateur?: boolean;
  coche?: boolean;
  desactive?: boolean;
  icone?: ReactNode;
}

export function ListeMenu({ elements, fermer, niveau = 0 }: { elements: ElementMenu[]; fermer: () => void; niveau?: number }) {
  const [ouvert, setOuvert] = useState<number | null>(null);
  // Comme sous Windows, un sous-menu ouvert ne cède la place qu'après un court délai :
  // on peut traverser une autre entrée en diagonale pour l'atteindre.
  const minuteur = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(minuteur.current), []);
  const survoler = (i: number) => {
    window.clearTimeout(minuteur.current);
    if (ouvert === null || !elements[ouvert]?.sousMenu) setOuvert(i);
    else minuteur.current = window.setTimeout(() => setOuvert(i), 280);
  };
  return (
    <div className="menu-liste" role="menu" data-niveau={niveau}>
      {elements.map((e, i) =>
        e.separateur ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            role="menuitem"
            className={`menu-el${e.desactive ? ' desactive' : ''}${ouvert === i ? ' survol' : ''}`}
            onMouseEnter={() => survoler(i)}
            onClick={(ev) => {
              ev.stopPropagation();
              if (e.desactive) return;
              if (e.sousMenu) {
                setOuvert(i);
                return;
              }
              fermer();
              e.action?.();
            }}
          >
            <span className="menu-coche">{e.coche ? '✓' : (e.icone ?? '')}</span>
            <span className="menu-libelle">{e.libelle}</span>
            <span className="menu-raccourci">{e.raccourci ?? ''}</span>
            <span className="menu-fleche">{e.sousMenu ? '▸' : ''}</span>
            {e.sousMenu && ouvert === i && (
              <div className="menu-sous" onMouseEnter={() => window.clearTimeout(minuteur.current)}>
                <ListeMenu elements={e.sousMenu} fermer={fermer} niveau={niveau + 1} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

/** Menu contextuel positionné à l'écran ; se referme au clic extérieur ou sur Échap. */
export function MenuContextuel({ x, y, elements, fermer }: { x: number; y: number; elements: ElementMenu[]; fermer: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(0, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(0, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    const clic = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) fermer();
    };
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && fermer();
    window.addEventListener('mousedown', clic);
    window.addEventListener('keydown', touche);
    return () => {
      window.removeEventListener('mousedown', clic);
      window.removeEventListener('keydown', touche);
    };
  }, [fermer]);
  return (
    <div ref={ref} className="menu-contextuel" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <ListeMenu elements={elements} fermer={fermer} />
    </div>
  );
}

export function useMenuContextuel() {
  const [menu, setMenu] = useState<{ x: number; y: number; elements: ElementMenu[] } | null>(null);
  const element = menu ? <MenuContextuel {...menu} fermer={() => setMenu(null)} /> : null;
  return { ouvrirMenu: (x: number, y: number, elements: ElementMenu[]) => setMenu({ x, y, elements }), element };
}

// ---------- Fenêtres de dialogue ----------

export function Fenetre({ titre, fermer, children, largeur = 420, className = '' }: { titre: string; fermer: () => void; children: ReactNode; largeur?: number; className?: string }) {
  const [decalage, setDecalage] = useState({ x: 0, y: 0 });
  const glisse = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  useEffect(() => {
    const t = (e: KeyboardEvent) => e.key === 'Escape' && fermer();
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [fermer]);
  return (
    <div className="voile" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
      <div className={`fenetre ${className}`} style={{ width: largeur, transform: `translate(${decalage.x}px, ${decalage.y}px)` }} role="dialog" aria-label={titre}>
        <div
          className="fenetre-titre"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            glisse.current = { x: e.clientX, y: e.clientY, dx: decalage.x, dy: decalage.y };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const g = glisse.current;
            if (g) setDecalage({ x: g.dx + e.clientX - g.x, y: g.dy + e.clientY - g.y });
          }}
          onPointerUp={() => {
            glisse.current = null;
          }}
        >
          <span>{titre}</span>
          <button className="fenetre-fermer" onClick={fermer} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="fenetre-corps">{children}</div>
      </div>
    </div>
  );
}

/** Champ numérique avec flèches, façon « spin box » de MT5 (molette et flèches du clavier acceptées). */
export function Spin({
  valeur,
  changer,
  pas,
  min = 0,
  max = Infinity,
  decimales,
  vide = false,
  placeholder,
  className = '',
  amorce,
}: {
  valeur: number;
  changer: (v: number) => void;
  pas: number;
  min?: number;
  max?: number;
  decimales: number;
  /** 0 s'affiche comme un champ vide (stop-loss / take-profit non définis). */
  vide?: boolean;
  placeholder?: string;
  className?: string;
  /** Valeur de départ des flèches quand le champ est vide (le prix actuel pour un stop). */
  amorce?: number;
}) {
  const [texte, setTexte] = useState(vide && valeur === 0 ? '' : valeur.toFixed(decimales));
  const focus = useRef(false);
  useEffect(() => {
    if (!focus.current) setTexte(vide && valeur === 0 ? '' : valeur.toFixed(decimales));
  }, [valeur, decimales, vide]);
  const borner = (v: number) => Number(Math.min(max, Math.max(min, v)).toFixed(decimales));
  const pousser = (sens: 1 | -1) => changer(borner(valeur === 0 && amorce ? amorce : valeur + sens * pas));
  return (
    <span className={`spin ${className}`}>
      <input
        value={texte}
        placeholder={placeholder}
        inputMode="decimal"
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
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            pousser(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      <span className="spin-fleches">
        <button type="button" tabIndex={-1} onClick={() => pousser(1)} aria-label="Augmenter">
          ▲
        </button>
        <button type="button" tabIndex={-1} onClick={() => pousser(-1)} aria-label="Diminuer">
          ▼
        </button>
      </span>
    </span>
  );
}

const VOLUMES_RAPIDES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];

/**
 * Volume du trading en un clic : le chiffre se modifie directement (clic = tout sélectionné, Entrée = valider),
 * boutons − / + et menu de volumes rapides.
 */
export function VolumeRapide({ valeur, changer, min, max, pas }: { valeur: number; changer: (v: number) => void; min: number; max: number; pas: number }) {
  const [texte, setTexte] = useState(valeur.toFixed(2));
  const [menu, setMenu] = useState(false);
  const focus = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus.current) setTexte(valeur.toFixed(2));
  }, [valeur]);
  useEffect(() => {
    if (!menu) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [menu]);
  const borner = (v: number) => Number(Math.min(max, Math.max(min, Math.round(v / pas) * pas)).toFixed(2));
  const valider = () => {
    const v = Number(texte.replace(',', '.'));
    const ok = Number.isFinite(v) && v > 0 ? borner(v) : valeur;
    changer(ok);
    setTexte(ok.toFixed(2));
  };
  const presets = VOLUMES_RAPIDES.filter((v) => v >= min && v <= max);
  return (
    <div className="volume-rapide" ref={ref} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="vr-pas" onClick={() => changer(borner(valeur - pas))} aria-label="Diminuer le volume">
        −
      </button>
      <input
        value={texte}
        inputMode="decimal"
        aria-label="Volume en lots"
        onFocus={(e) => {
          focus.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focus.current = false;
          valider();
        }}
        onChange={(e) => setTexte(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setTexte(valeur.toFixed(2));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            changer(borner(valeur + (e.key === 'ArrowUp' ? pas : -pas)));
          }
        }}
      />
      <button type="button" className="vr-pas" onClick={() => changer(borner(valeur + pas))} aria-label="Augmenter le volume">
        +
      </button>
      <button type="button" className="vr-menu" onClick={() => setMenu(!menu)} aria-label="Volumes rapides">
        ▾
      </button>
      {menu && (
        <div className="vr-liste">
          {presets.map((v) => (
            <button
              key={v}
              className={v === valeur ? 'actif' : ''}
              onClick={() => {
                changer(v);
                setMenu(false);
              }}
            >
              {v.toFixed(2)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
