import { useEffect, useRef } from 'react';
import { useTerminal } from '../contexte';
import { argent, dateMT } from './ui';

/** Courbe de solde (bleue) et, en option, de fonds propres (verte), dessinée sur un canevas. */
export function CourbeSolde({ points, fonds, hauteur = 200 }: { points: { t: number; v: number }[]; fonds?: { t: number; v: number }[]; hauteur?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { etat } = useTerminal();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const l = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = l * dpr;
    canvas.height = h * dpr;
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const sombre = etat.theme === 'sombre';
    g.fillStyle = sombre ? '#151924' : '#fff';
    g.fillRect(0, 0, l, h);
    if (points.length < 2) {
      g.fillStyle = '#888';
      g.font = '12px Tahoma, sans-serif';
      g.fillText('La courbe apparaîtra après vos premières positions fermées.', 12, h / 2);
      return;
    }
    const tous = [...points, ...(fonds ?? [])];
    const min = Math.min(...tous.map((p) => p.v));
    const max = Math.max(...tous.map((p) => p.v));
    const t0 = Math.min(...tous.map((p) => p.t));
    const t1 = Math.max(...tous.map((p) => p.t));
    const marge = (max - min) * 0.1 || 1;
    const bas = min - marge;
    const haut = max + marge;
    const gauche = 70;
    // Abscisse proportionnelle au temps, pour superposer solde et fonds propres.
    const xt = (t: number) => gauche + (t1 > t0 ? (t - t0) / (t1 - t0) : 0) * (l - gauche - 10);
    const y = (v: number) => 8 + (1 - (v - bas) / (haut - bas)) * (h - 24);
    g.font = '10px Tahoma, sans-serif';
    for (let k = 0; k <= 4; k++) {
      const v = bas + ((haut - bas) * k) / 4;
      g.strokeStyle = sombre ? '#232836' : '#eee';
      g.beginPath();
      g.moveTo(gauche, y(v));
      g.lineTo(l - 10, y(v));
      g.stroke();
      g.fillStyle = sombre ? '#8a93a6' : '#666';
      g.fillText(argent(v), 4, y(v) + 3);
    }
    // Aire sous la courbe puis la courbe de solde.
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(xt(p.t), y(p.v)) : g.lineTo(xt(p.t), y(p.v))));
    g.lineTo(xt(points[points.length - 1].t), h - 16);
    g.lineTo(xt(points[0].t), h - 16);
    g.closePath();
    g.fillStyle = 'rgba(30, 111, 217, 0.12)';
    g.fill();
    if (fonds && fonds.length > 1) {
      g.beginPath();
      fonds.forEach((p, i) => (i === 0 ? g.moveTo(xt(p.t), y(p.v)) : g.lineTo(xt(p.t), y(p.v))));
      g.strokeStyle = '#1e9e3a';
      g.lineWidth = 1;
      g.stroke();
    }
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo(xt(p.t), y(p.v)) : g.lineTo(xt(p.t), y(p.v))));
    g.strokeStyle = '#1e6fd9';
    g.lineWidth = 1.6;
    g.stroke();
    g.fillStyle = sombre ? '#8a93a6' : '#666';
    g.fillText(dateMT(t0, false), gauche, h - 3);
    const fin = dateMT(t1, false);
    g.fillText(fin, l - 10 - g.measureText(fin).width, h - 3);
  });
  return <canvas ref={ref} className="courbe-solde" style={{ height: hauteur }} />;
}

