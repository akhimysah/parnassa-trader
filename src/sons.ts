/** Petits sons synthétisés (aucun fichier audio) : exécution, alerte, erreur, stop-out. */
let ctx: AudioContext | null = null;

function note(freq: number, debut: number, duree: number, volume = 0.08, forme: OscillatorType = 'sine') {
  ctx ??= new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = forme;
  o.frequency.value = freq;
  const t = ctx.currentTime + debut;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + duree + 0.05);
}

export type Son = 'ok' | 'alerte' | 'erreur' | 'stop';

export function jouer(son: Son) {
  try {
    if (son === 'ok') {
      note(880, 0, 0.12);
      note(1320, 0.08, 0.18);
    } else if (son === 'alerte') {
      note(988, 0, 0.15, 0.1, 'triangle');
      note(988, 0.22, 0.15, 0.1, 'triangle');
      note(1319, 0.44, 0.3, 0.1, 'triangle');
    } else if (son === 'erreur') {
      note(220, 0, 0.25, 0.1, 'square');
    } else {
      note(440, 0, 0.2, 0.1, 'sawtooth');
      note(330, 0.2, 0.35, 0.1, 'sawtooth');
    }
  } catch {
    // audio indisponible
  }
}
