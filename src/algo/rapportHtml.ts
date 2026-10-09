/**
 * Rapport HTML autonome, comme « Enregistrer comme rapport » de MT5 : en-tête, résultats, courbe de solde en SVG
 * et liste des transactions. Un seul fichier, sans dépendance, lisible hors ligne et imprimable.
 */
import type { Transaction } from '../compte/moteur';
import { calculerStats } from './statistiques';

const echapper = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const argent = (v: number) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)} %` : '—');

function courbeSvg(points: { t: number; v: number }[]): string {
  if (points.length < 2) return '';
  const l = 900;
  const h = 220;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t || t0 + 1;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * (l - 20) + 10;
  const y = (v: number) => h - 10 - ((v - min) / (max - min || 1)) * (h - 20);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${l} ${h}" class="courbe" role="img" aria-label="Courbe de solde"><path d="${d}" fill="none" stroke="#1e6fd9" stroke-width="2"/><text x="12" y="16">${argent(max)}</text><text x="12" y="${h - 14}">${argent(min)}</text></svg>`;
}

export interface EnteteRapport {
  titre: string;
  lignes: [string, string][];
}

export function rapportHtml(entete: EnteteRapport, transactions: Transaction[]): string {
  const s = calculerStats(transactions);
  const signe = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const resultats: [string, string, string?][] = [
    ['Bénéfice net total', argent(s.net), signe(s.net)],
    ['Profit brut', argent(s.brutGain), 'pos'],
    ['Perte brute', argent(s.brutPerte), 'neg'],
    ['Facteur de profit', s.facteur === null ? '—' : s.facteur.toFixed(2)],
    ['Gain espéré', argent(s.esperance), signe(s.esperance)],
    ['Facteur de récupération', s.recouvrement === null ? '—' : s.recouvrement.toFixed(2)],
    ['Ratio de Sharpe', s.sharpe === null ? '—' : s.sharpe.toFixed(2)],
    ['Drawdown absolu', argent(s.ddAbsolu)],
    ['Drawdown maximal', `${argent(s.ddMax)} (${s.ddMaxPct.toFixed(2)} %)`],
    ['Trades au total', String(s.trades)],
    ['Positions longues (% gagnantes)', `${s.longs} (${pct(s.longsGagnants, s.longs)})`],
    ['Positions courtes (% gagnantes)', `${s.courts} (${pct(s.courtsGagnants, s.courts)})`],
    ['Trades gagnants', `${s.gagnants} (${pct(s.gagnants, s.trades)})`],
    ['Plus gros gain', argent(s.plusGrosGain), 'pos'],
    ['Plus grosse perte', argent(s.plusGrossePerte), 'neg'],
    ['Gain moyen', argent(s.gainMoyen), 'pos'],
    ['Perte moyenne', argent(s.perteMoyenne), 'neg'],
    ['Gains consécutifs max.', `${s.seriesGains.n} (${argent(s.seriesGains.montant)})`],
    ['Pertes consécutives max.', `${s.seriesPertes.n} (${argent(s.seriesPertes.montant)})`],
    ['Dépôts / retraits', `${argent(s.depots)} / ${argent(s.retraits)}`],
  ];
  const deals = [...transactions].sort((a, b) => a.heure - b.heure || a.ticket - b.ticket);
  const ligneDeal = (d: Transaction) =>
    `<tr><td>${date(d.heure)}</td><td>${d.ticket}</td><td>${echapper(d.symbole)}</td><td>${d.type}</td><td>${d.entree}</td><td class="n">${d.volume ? d.volume.toFixed(2) : ''}</td><td class="n">${d.prix || ''}</td><td class="n">${d.commission ? argent(d.commission) : ''}</td><td class="n">${d.swap ? argent(d.swap) : ''}</td><td class="n ${signe(d.profit)}">${argent(d.profit)}</td><td class="n">${argent(d.solde)}</td><td>${echapper(d.commentaire)}</td></tr>`;
  const parSymbole = s.parSymbole
    .map((p) => `<tr><td>${echapper(p.symbole)}</td><td class="n">${p.trades}</td><td class="n">${pct(p.gagnants, p.trades)}</td><td class="n ${signe(p.net)}">${argent(p.net)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${echapper(entete.titre)}</title>
<style>
body{font:13px/1.45 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1d1d1f;margin:24px auto;max-width:1100px;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;border-bottom:2px solid #1e6fd9;padding-bottom:3px}
table{border-collapse:collapse;width:100%}td,th{padding:3px 8px;border-bottom:1px solid #e3e3e8;text-align:left;white-space:nowrap}
th{background:#f2f4f8;font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}.pos{color:#1a7f37}.neg{color:#cf222e}
.grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 24px}.courbe{width:100%;height:auto;background:#fafbfd;border:1px solid #e3e3e8}
.courbe text{font-size:12px;fill:#6e6e73}.muet{color:#6e6e73}.defile{overflow-x:auto}
@media print{body{margin:0}h2{break-after:avoid}}
</style></head><body>
<h1>${echapper(entete.titre)}</h1>
<p class="muet">Parnassa Trader · rapport du ${date(Date.now())} · argent fictif (compte de démonstration)</p>
<table>${entete.lignes.map(([k, v]) => `<tr><th>${echapper(k)}</th><td>${echapper(v)}</td></tr>`).join('')}</table>
<h2>Résultats</h2>
<div class="grille"><table>${resultats
    .slice(0, 10)
    .map(([k, v, c]) => `<tr><td>${k}</td><td class="n ${c ?? ''}">${v}</td></tr>`)
    .join('')}</table><table>${resultats
    .slice(10)
    .map(([k, v, c]) => `<tr><td>${k}</td><td class="n ${c ?? ''}">${v}</td></tr>`)
    .join('')}</table></div>
<h2>Courbe de solde</h2>
${courbeSvg(s.courbe)}
${parSymbole ? `<h2>Par symbole</h2><table><tr><th>Symbole</th><th class="n">Trades</th><th class="n">Gagnants</th><th class="n">Net</th></tr>${parSymbole}</table>` : ''}
<h2>Transactions (${deals.length})</h2>
<div class="defile"><table><tr><th>Heure</th><th>Transaction</th><th>Symbole</th><th>Type</th><th>Sens</th><th class="n">Volume</th><th class="n">Prix</th><th class="n">Commission</th><th class="n">Swap</th><th class="n">Profit</th><th class="n">Solde</th><th>Commentaire</th></tr>
${deals.map(ligneDeal).join('\n')}</table></div>
</body></html>`;
}

/** Télécharge le rapport (ou le partage sur téléphone quand le partage de fichiers est possible). */
export async function enregistrerRapport(nom: string, html: string): Promise<void> {
  const fichier = new File([html], nom, { type: 'text/html' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [fichier] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [fichier], title: nom });
      return;
    } catch {
      // partage annulé : téléchargement classique
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(fichier);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** En-tête d'un rapport de compte : titulaire, serveur, levier, solde. */
export function enteteCompte(c: { login: number; nom: string; serveur: string; levier: number; solde: number; type?: string }): EnteteRapport {
  return {
    titre: `Rapport de trading — ${c.login} : ${c.nom}`,
    lignes: [
      ['Compte', `${c.login} (${c.nom})`],
      ['Serveur', c.serveur],
      ['Type', `Démo ${c.type === 'raw' ? 'Raw' : 'Standard'}, couverture, USD`],
      ['Levier', `1:${c.levier}`],
      ['Solde', `${argent(c.solde)} USD`],
    ],
  };
}
