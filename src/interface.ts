import { useEffect, useState } from 'react';

/** Interface choisie : automatique selon la largeur de l'écran, ou forcée en mobile / ordinateur. */
export type ModeInterface = 'auto' | 'mobile' | 'bureau';

const CLE = 'parnassa-trader:interface';
const REQUETE = '(max-width: 820px)';
const ecouteurs = new Set<() => void>();

function lire(): ModeInterface {
  const param = new URLSearchParams(window.location.search).get('interface');
  if (param === 'mobile' || param === 'bureau') return param;
  try {
    const v = localStorage.getItem(CLE);
    return v === 'mobile' || v === 'bureau' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function choisirInterface(m: ModeInterface) {
  try {
    if (m === 'auto') localStorage.removeItem(CLE);
    else localStorage.setItem(CLE, m);
  } catch {
    // stockage indisponible : le choix vaut pour la session
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has('interface')) {
    url.searchParams.delete('interface');
    window.history.replaceState(null, '', url);
  }
  for (const f of ecouteurs) f();
}

/** { mobile: interface mobile affichée ?, force: choisie à la main sur un grand écran ?, mode } */
export function useInterface(): { mobile: boolean; force: boolean; mode: ModeInterface } {
  const [mode, setMode] = useState<ModeInterface>(lire);
  const [petit, setPetit] = useState(() => window.matchMedia(REQUETE).matches);
  useEffect(() => {
    const m = window.matchMedia(REQUETE);
    const h = () => setPetit(m.matches);
    const c = () => setMode(lire());
    m.addEventListener('change', h);
    ecouteurs.add(c);
    return () => {
      m.removeEventListener('change', h);
      ecouteurs.delete(c);
    };
  }, []);
  const mobile = mode === 'mobile' || (mode === 'auto' && petit);
  return { mobile, force: mobile && !petit, mode };
}
