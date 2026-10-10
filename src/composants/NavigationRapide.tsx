import { useState } from 'react';
import { PERIODES, type Periode } from '../marche/bougies';
import { SYMBOLES } from '../marche/symboles';

/** Interprète « GBPUSD », « H4 » ou « XAUUSD,M15 » : symbole et/ou période, comme la navigation rapide de MT5. */
export function interpreter(texte: string): { symbole?: string; periode?: Periode } | null {
  const morceaux = texte.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const r: { symbole?: string; periode?: Periode } = {};
  for (const m of morceaux) {
    const p = PERIODES.find((x) => x.id === m);
    if (p) {
      r.periode = p.id;
      continue;
    }
    const exact = SYMBOLES.find((s) => s.nom === m);
    const debut = SYMBOLES.filter((s) => s.nom.startsWith(m));
    const s = exact ?? (debut.length === 1 ? debut[0] : undefined);
    if (!s) return null;
    r.symbole = s.nom;
  }
  return r.symbole || r.periode ? r : null;
}

/**
 * Navigation rapide : en tapant au clavier sur un graphique, un champ s'ouvre en bas à gauche ; Entrée change le
 * symbole et / ou la période du graphique actif, Échap referme.
 */
export function NavigationRapide({ initial, appliquer, fermer }: { initial: string; appliquer: (r: { symbole?: string; periode?: Periode }) => void; fermer: () => void }) {
  const [texte, setTexte] = useState(initial);
  const r = interpreter(texte);
  const propositions = texte.length
    ? [
        ...SYMBOLES.filter((s) => s.nom.startsWith(texte.toUpperCase().split(/[\s,;]+/)[0])).slice(0, 6).map((s) => `${s.nom} — ${s.description}`),
        ...PERIODES.filter((p) => p.id.startsWith(texte.toUpperCase())).map((p) => `${p.id} — ${p.libelle}`),
      ]
    : [];
  return (
    <div className="navigation-rapide">
      <input
        autoFocus
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onBlur={fermer}
        onKeyDown={(e) => {
          if (e.key === 'Escape') fermer();
          if (e.key === 'Enter') {
            if (r) appliquer(r);
            fermer();
          }
          e.stopPropagation();
        }}
        spellCheck={false}
        aria-label="Navigation rapide : symbole et / ou période"
      />
      <div className={`navigation-etat ${r ? 'ok' : ''}`}>{r ? [r.symbole, r.periode].filter(Boolean).join(', ') : 'symbole et / ou période (ex. GBPUSD,H4)'}</div>
      {propositions.length > 0 && (
        <ul>
          {propositions.map((p) => (
            <li
              key={p}
              onMouseDown={(e) => {
                e.preventDefault();
                const res = interpreter(p.split(' — ')[0]);
                if (res) appliquer(res);
                fermer();
              }}
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
