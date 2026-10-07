import { useEffect, useState } from 'react';

/** Invitation d'installation (Chrome / Android) gardée dès le démarrage, et détection d'iOS. */
interface InviteInstallation extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let invite: InviteInstallation | null = null;
const ecouteurs = new Set<() => void>();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  invite = e as InviteInstallation;
  for (const f of ecouteurs) f();
});
window.addEventListener('appinstalled', () => {
  invite = null;
  for (const f of ecouteurs) f();
});

export function estInstallee(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function estIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 'invite' : le navigateur peut installer ; 'ios' : instructions Safari ; 'installee' ; 'indisponible'. */
export function useInstallation(): { etat: 'invite' | 'ios' | 'installee' | 'indisponible'; installer: () => Promise<boolean> } {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    ecouteurs.add(f);
    return () => {
      ecouteurs.delete(f);
    };
  }, []);
  const etat = estInstallee() ? 'installee' : invite ? 'invite' : estIOS() ? 'ios' : 'indisponible';
  return {
    etat,
    installer: async () => {
      if (!invite) return false;
      await invite.prompt();
      const choix = await invite.userChoice;
      invite = null;
      for (const f of ecouteurs) f();
      return choix.outcome === 'accepted';
    },
  };
}
