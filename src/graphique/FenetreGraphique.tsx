import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useTerminal } from '../contexte';
import type { Graphique, ObjetGraphique } from '../etat';
import { identifiant } from '../etat';
import { chargerBougies, debutBougie, PERIODES, type Bougie } from '../marche/bougies';
import { formaterPrix, point, symbole } from '../marche/symboles';
import { calculer, definition, nomCourt } from './indicateurs';
import { couleursSchema } from './couleurs';
import { Dessins, OBJETS } from './dessins';

/** Indicateurs en sous-fenêtre exprimés en prix : même nombre de décimales que le symbole (l'échelle reste aussi large). */
const EN_PRIX = ['atr', 'stddev', 'bears', 'bulls', 'ao', 'ac'];
import { menuModeles } from '../composants/Barres';
import { registreGraphiques } from './registre';
import { decider, definitionExpert } from '../algo/experts';
import { journaliser, LIBELLES_TYPE, modifierOrdre, modifierPosition, ouvrirMarche, sensDe, supprimerOrdre, fermerPosition, type TypeEnAttente } from '../compte/moteur';
import { PrixGros, VolumeRapide, useMenuContextuel, type ElementMenu } from '../composants/ui';

interface Props {
  g: Graphique;
  actif: boolean;
  activer: () => void;
  /** Mobile : appui long (ou clic droit) sur le graphique, avec le prix pointé — remplace le menu contextuel. */
  appuiLong?: (prix: number) => void;
  /** Mobile : appui long sur une ligne de position / d'ordre (sans la déplacer) — ouvre sa modification. */
  appuiLigne?: (genre: 'position' | 'ordre', ticket: number) => void;
}

/** Ligne déplaçable à la souris : stop-loss, take-profit, ordre en attente, ouverture de position, ligne horizontale. */
interface Deplacable {
  genre: 'sl' | 'tp' | 'ordre' | 'position' | 'objet';
  ticket: number;
  objet?: string;
  prix: number;
  ligne: IPriceLine;
}

/** Les temps sont en UTC : l'axe et la croix affichent l'heure locale, comme le reste du terminal. */
const z2 = (n: number) => String(n).padStart(2, '0');
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function heureLocale(t: Time): string {
  const d = new Date(Number(t) * 1000);
  return `${z2(d.getDate())} ${MOIS[d.getMonth()]} ${d.getFullYear()} ${z2(d.getHours())}:${z2(d.getMinutes())}`;
}
function graduation(t: Time, type: TickMarkType): string {
  const d = new Date(Number(t) * 1000);
  if (type === TickMarkType.Year) return String(d.getFullYear());
  if (type === TickMarkType.Month) return MOIS[d.getMonth()];
  if (type === TickMarkType.DayOfMonth) return String(d.getDate());
  return `${z2(d.getHours())}:${z2(d.getMinutes())}`;
}

const FIBO = [0, 0.236, 0.382, 0.5, 0.618, 1, 1.618];

/** Les nettoyages peuvent passer après la destruction du graphique (démontage) : on ignore alors l'erreur. */
function sansErreur(f: () => void) {
  try {
    f();
  } catch {
    // graphique déjà détruit
  }
}

export function FenetreGraphique({ g, actif, activer, appuiLong, appuiLigne }: Props) {
  const t = useTerminal();
  const { etat, compte, cotations, operer, ouvrir, majGraphique, survol, outil, choisirOutil } = t;
  const s = symbole(g.symbole)!;
  const sombre = etat.theme === 'sombre';
  const coul = useMemo(() => couleursSchema(g.schema, sombre), [g.schema, sombre]);
  const cot = cotations[g.symbole];
  const conteneur = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const serieRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const marqueursRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const bougiesRef = useRef<Bougie[]>([]);
  const [version, setVersion] = useState(0);
  /** Incrémenté quand la série principale est recréée : les lignes de prix doivent alors être reposées. */
  const [versionSerie, setVersionSerie] = useState(0);
  const [chargement, setChargement] = useState<'en-cours' | 'ok' | 'vide'>('en-cours');
  const deplacables = useRef<Deplacable[]>([]);
  const glisse = useRef<{ d: Deplacable; prix: number } | null>(null);
  const appui = useRef<{ x: number; y: number } | null>(null);
  const minuteurAppui = useRef<number | undefined>(undefined);
  const premierPoint = useRef<{ t: number; prix: number }[]>([]);
  const [etape, setEtape] = useState(0);
  const dessinsRef = useRef<Dessins | null>(null);
  /** Point d'objet tiré (index), ou objet entier (index -1) avec ses points et le point de départ du pointeur. */
  const glisseObjet = useRef<{ id: string; index: number; depart?: { t: number; prix: number }; points?: { t: number; prix: number }[] } | null>(null);
  // Nouvel outil (ou Échap) : les points déjà posés sont oubliés.
  useEffect(() => {
    premierPoint.current = [];
    setEtape(0);
  }, [outil]);
  // Volume du panneau un clic, mémorisé par graphique (ramené aux limites du symbole affiché).
  const volume = Math.min(s.volumeMax, Math.max(s.volumeMin, g.volumeUnClic ?? etat.volumeDefaut));
  const setVolume = (v: number) => majGraphique(g.id, { volumeUnClic: v });
  const [hauteursPanneaux, setHauteursPanneaux] = useState<number[]>([]);
  const { ouvrirMenu, element: menu } = useMenuContextuel();
  const refEtat = useRef({ g, compte, cotations, outil, algo: etat.algo, appuiLong, appuiLigne });
  refEtat.current = { g, compte, cotations, outil, algo: etat.algo, appuiLong, appuiLigne };
  /** Dernière barre clôturée déjà soumise à l'Expert Advisor (il ne trade jamais sur l'historique). */
  const derniereTraitee = useRef(0);

  const versBougie = (b: Bougie) => {
    if (g.type === 'ligne') return { time: b.time as UTCTimestamp, value: b.close };
    return { time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close };
  };

  // ---------- Création du graphique ----------
  useEffect(() => {
    const el = conteneur.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: coul.fond }, textColor: coul.texte, fontFamily: 'Tahoma, "Segoe UI", sans-serif', fontSize: 11, attributionLogo: true, panes: { separatorColor: coul.grille } },
      grid: { vertLines: { color: coul.grille, style: LineStyle.Dotted, visible: g.grille }, horzLines: { color: coul.grille, style: LineStyle.Dotted, visible: g.grille } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: coul.texte, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: coul.texte, timeVisible: true, secondsVisible: false, rightOffset: g.decalage ? 12 : 2, shiftVisibleRangeOnNewBar: g.defilement, tickMarkFormatter: graduation },
      localization: { locale: 'fr-FR', timeFormatter: heureLocale },
    });
    chartRef.current = chart;
    const surCroix = (p: MouseEventParams<Time>) => {
      const serie = serieRef.current;
      if (!serie || !p.time) return survol(null);
      const d = p.seriesData.get(serie) as { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined;
      if (!d) return survol(null);
      const b = bougiesRef.current.find((x) => x.time === p.time);
      const c = d.close ?? d.value ?? 0;
      survol({ temps: Number(p.time) * 1000, o: d.open ?? c, h: d.high ?? c, l: d.low ?? c, c, v: b?.volume ?? 0, chiffres: symbole(refEtat.current.g.symbole)?.chiffres ?? 5 });
    };
    chart.subscribeCrosshairMove(surCroix);
    const surClic = (p: MouseEventParams<Time>) => {
      const o = refEtat.current.outil;
      const serie = serieRef.current;
      if (!o || !p.point || !serie) return;
      const prix = serie.coordinateToPrice(p.point.y);
      const temps = p.time !== undefined ? Number(p.time) : (chart.timeScale().coordinateToTime(p.point.x) as number | null);
      if (prix === null || temps === null || temps === undefined) return;
      const pt = { t: Number(temps), prix: Number(prix.toFixed(symbole(refEtat.current.g.symbole)?.chiffres ?? 5)) };
      const ajouter = (objet: ObjetGraphique) => {
        majGraphique(refEtat.current.g.id, (gr) => ({ objets: [...gr.objets, objet] }));
        choisirOutil(null);
        premierPoint.current = [];
      };
      const def = OBJETS[o];
      const points = [...premierPoint.current, pt];
      // Deux points au même instant ne font ni ligne ni rectangle.
      if (points.length === 2 && o !== 'canal' && points[0].t === points[1].t) return;
      if (points.length < def.points) {
        premierPoint.current = points;
        setEtape(points.length);
        return;
      }
      setEtape(0);
      if (o === 'texte') {
        const texte = window.prompt('Texte à placer sur le graphique')?.trim();
        if (!texte) {
          choisirOutil(null);
          premierPoint.current = [];
          return;
        }
        return ajouter({ id: identifiant(), type: o, points, couleur: def.couleur, texte: texte.slice(0, 80) });
      }
      // Les deux premiers points sont rangés dans l'ordre du temps (le troisième du canal reste à part).
      const tries = points.length >= 2 && points[0].t > points[1].t ? [points[1], points[0], ...points.slice(2)] : points;
      ajouter({ id: identifiant(), type: o, points: tries, couleur: def.couleur });
    };
    chart.subscribeClick(surClic);
    registreGraphiques.set(g.id, {
      zoomer: (f) => {
        const ts = chart.timeScale();
        ts.applyOptions({ barSpacing: Math.max(0.5, Math.min(50, ts.options().barSpacing * f)) });
      },
      capturer: () => {
        const canvas = chart.takeScreenshot();
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${refEtat.current.g.symbole}_${refEtat.current.g.periode}.png`;
        a.click();
      },
      allerALaFin: () => chart.timeScale().scrollToRealTime(),
      recharger: () => setVersion((v) => v + 1),
    });
    const ro = new ResizeObserver(() => setHauteursPanneaux(chart.panes().map((p) => p.getHeight())));
    ro.observe(el);
    return () => {
      ro.disconnect();
      registreGraphiques.delete(g.id);
      chart.unsubscribeCrosshairMove(surCroix);
      chart.unsubscribeClick(surClic);
      // Destruction à l'image suivante : le graphique peut avoir un dessin en attente (montage puis démontage immédiat).
      requestAnimationFrame(() => chart.remove());
      chartRef.current = null;
      serieRef.current = null;
      seriesIndicateurs.current = [];
      ligneAsk.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Options visuelles (schéma, grille, décalage, défilement).
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: coul.fond }, textColor: coul.texte, panes: { separatorColor: coul.grille } },
      grid: { vertLines: { color: coul.grille, visible: g.grille }, horzLines: { color: coul.grille, visible: g.grille } },
      rightPriceScale: { borderColor: coul.texte },
      timeScale: { borderColor: coul.texte, rightOffset: g.decalage ? 12 : 2, shiftVisibleRangeOnNewBar: g.defilement },
    });
  }, [coul, g.grille, g.decalage, g.defilement]);

  // ---------- Série principale (type de graphique) ----------
  useEffect(() => {
    const chart = chartRef.current!;
    const format = { type: 'price' as const, precision: s.chiffres, minMove: point(s) };
    let serie: ISeriesApi<SeriesType>;
    const commun = { priceFormat: format, priceLineColor: coul.bid, priceLineStyle: LineStyle.Solid, priceLineWidth: 1 as const };
    if (g.type === 'ligne') serie = chart.addSeries(LineSeries, { ...commun, color: coul.ligne, lineWidth: 1 });
    else if (g.type === 'barres') serie = chart.addSeries(BarSeries, { ...commun, upColor: coul.hausse, downColor: coul.baisse, thinBars: true });
    else serie = chart.addSeries(CandlestickSeries, { ...commun, upColor: coul.corpsHausse, downColor: coul.corpsBaisse, borderUpColor: coul.hausse, borderDownColor: coul.baisse, wickUpColor: coul.hausse, wickDownColor: coul.baisse });
    serieRef.current = serie;
    serie.setData(bougiesRef.current.map(versBougie));
    marqueursRef.current = createSeriesMarkers(serie, []);
    dessinsRef.current = new Dessins();
    serie.attachPrimitive(dessinsRef.current);
    chart.panes()[0]?.setStretchFactor(3);
    setVersion((v) => v + 1);
    setVersionSerie((v) => v + 1);
    return () => {
      sansErreur(() => marqueursRef.current?.detach());
      marqueursRef.current = null;
      const d = dessinsRef.current;
      if (d) sansErreur(() => serie.detachPrimitive(d));
      dessinsRef.current = null;
      sansErreur(() => chart.removeSeries(serie));
      deplacables.current = [];
      if (serieRef.current === serie) serieRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.type, coul, s]);

  // Objets dessinés sur le canevas (verticales, rectangles, canaux, textes), recalés à chaque nouvelle barre.
  const nbBarres = bougiesRef.current.length;
  useEffect(() => {
    dessinsRef.current?.definir(g.objets, bougiesRef.current.map((b) => b.time));
  }, [g.objets, version, versionSerie, nbBarres]);

  // ---------- Historique ----------
  const [rechargement, setRechargement] = useState(0);
  useEffect(() => {
    let annule = false;
    setChargement('en-cours');
    bougiesRef.current = [];
    serieRef.current?.setData([]);
    const reference = cot ? (cot.bid + cot.ask) / 2 : undefined;
    chargerBougies(s, g.periode, reference)
      .then((b) => {
        if (annule) return;
        bougiesRef.current = b;
        derniereTraitee.current = b[b.length - 2]?.time ?? 0;
        serieRef.current?.setData(b.map(versBougie));
        chartRef.current?.timeScale().applyOptions({ barSpacing: 7 });
        chartRef.current?.timeScale().scrollToRealTime();
        setChargement(b.length ? 'ok' : 'vide');
        setVersion((v) => v + 1);
      })
      .catch(() => {
        if (annule) return;
        setChargement('vide');
      });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.symbole, g.periode, rechargement]);
  useEffect(() => {
    const r = registreGraphiques.get(g.id);
    if (r) r.recharger = () => setRechargement((v) => v + 1);
  }, [g.id]);
  // Amorce la cotation de référence d'un symbole recalé dès qu'elle arrive.
  const aCotation = Boolean(cot);
  useEffect(() => {
    if (aCotation && s.histo.recaler && chargement === 'vide') setRechargement((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aCotation]);

  // ---------- Expert Advisor : décision à la clôture de chaque barre ----------
  useEffect(() => {
    // Attacher un expert ou activer l'Algo Trading ne déclenche pas de trade sur la barre déjà fermée.
    const b = bougiesRef.current;
    derniereTraitee.current = b[b.length - 2]?.time ?? 0;
  }, [g.expert, etat.algo]);
  const executerExpert = () => {
    const { g: gr, cotations: cot, algo } = refEtat.current;
    const e = gr.expert;
    if (!e || !algo) return;
    const fermees = bougiesRef.current.slice(0, -1);
    const derniere = fermees[fermees.length - 1];
    if (!derniere || derniere.time <= derniereTraitee.current) return;
    derniereTraitee.current = derniere.time;
    const sy = symbole(gr.symbole)!;
    const q = cot[gr.symbole];
    const nom = definitionExpert(e.type).nom;
    const miennes = (c: typeof compte) => c.positions.filter((p) => p.magic === e.magic && p.symbole === gr.symbole);
    const d = decider(e, fermees, miennes(refEtat.current.compte)[0]?.type ?? null);
    if (!q || (d.fermer.length === 0 && !d.ouvrir)) return;
    operer(
      (c) => {
        let cc = journaliser(c, 'Experts', `${nom} (${gr.symbole},${gr.periode}) : signal — ${d.raison}`);
        for (const p of miennes(cc).filter((x) => d.fermer.includes(x.type))) {
          const r = fermerPosition(cc, p.ticket, cot);
          if (!r.erreur) cc = r.compte;
        }
        if (!d.ouvrir || miennes(cc).some((x) => x.type === d.ouvrir)) return { compte: cc, erreur: null, message: `${nom} : ${d.raison}` };
        const sens = d.ouvrir === 'buy' ? 1 : -1;
        const prix = d.ouvrir === 'buy' ? q.ask : q.bid;
        const arrondi = (v: number) => Number(v.toFixed(sy.chiffres));
        const volume = Math.min(sy.volumeMax, Math.max(sy.volumeMin, Math.round(e.p.volume / sy.pasVolume) * sy.pasVolume));
        const r = ouvrirMarche(
          cc,
          {
            symbole: gr.symbole,
            type: d.ouvrir,
            volume: Number(volume.toFixed(2)),
            sl: e.p.sl ? arrondi(prix - sens * e.p.sl * point(sy)) : 0,
            tp: e.p.tp ? arrondi(prix + sens * e.p.tp * point(sy)) : 0,
            commentaire: nom,
            magic: e.magic,
          },
          cot,
        );
        return { ...r, message: r.message ? `${nom} : ${r.message}` : undefined };
      },
      { confirmation: false },
    );
  };

  // ---------- Mise à jour en direct (sur le Bid, comme MT5) ----------
  useEffect(() => {
    const serie = serieRef.current;
    if (!cot || !serie || chargement === 'en-cours') return;
    const maintenant = Math.floor(Date.now() / 1000);
    const debut = debutBougie(maintenant, g.periode);
    const b = bougiesRef.current;
    const der = b[b.length - 1];
    const prix = cot.bid;
    const tickVolume = s.histo.binance ? 0 : 1;
    if (der && der.time === debut) {
      if (der.close === prix) return;
      der.high = Math.max(der.high, prix);
      der.low = Math.min(der.low, prix);
      der.close = prix;
      der.volume += tickVolume;
    } else if (!der || debut > der.time) {
      b.push({ time: debut, open: der?.close ?? prix, high: Math.max(prix, der?.close ?? prix), low: Math.min(prix, der?.close ?? prix), close: prix, volume: tickVolume });
      if (chargement === 'vide' && b.length === 1) setChargement('ok');
      executerExpert();
    } else return;
    serie.update(versBougie(b[b.length - 1]));
    // Les indicateurs sont recalculés au plus une fois par seconde.
    if (!majIndicateurs.current) {
      majIndicateurs.current = window.setTimeout(() => {
        majIndicateurs.current = undefined;
        setVersion((v) => v + 1);
      }, 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cot?.bid]);
  const majIndicateurs = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(majIndicateurs.current), []);

  // ---------- Indicateurs ----------
  const seriesIndicateurs = useRef<{ id: string; series: ISeriesApi<SeriesType>[] }[]>([]);
  const cleIndicateurs = JSON.stringify(g.indicateurs);
  useEffect(() => {
    const chart = chartRef.current!;
    for (const x of seriesIndicateurs.current) for (const se of x.series) sansErreur(() => chart.removeSeries(se));
    seriesIndicateurs.current = [];
    for (let i = chart.panes().length - 1; i >= 1; i--) sansErreur(() => chart.removePane(i));
    let panneau = 0;
    for (const ind of g.indicateurs) {
      const def = definition(ind.type);
      const index = def.superpose ? 0 : ++panneau;
      const r = calculer(ind, bougiesRef.current);
      const series = r.traces.map((tr) => {
        const commun = { lastValueVisible: !def.superpose, priceLineVisible: false, title: '', crosshairMarkerVisible: false };
        const se =
          tr.style === 'histogramme'
            ? chart.addSeries(HistogramSeries, { ...commun, color: tr.couleur, priceFormat: def.type === 'volumes' ? { type: 'volume' } : { type: 'price', precision: s.chiffres, minMove: point(s) } }, index)
            : chart.addSeries(LineSeries, { ...commun, color: tr.couleur, lineWidth: 1, lineVisible: tr.style !== 'points', pointMarkersVisible: tr.style === 'points', pointMarkersRadius: 1.5, priceFormat: def.superpose || EN_PRIX.includes(def.type) ? { type: 'price', precision: s.chiffres, minMove: point(s) } : def.type === 'demarker' || def.type === 'rvi' ? { type: 'price', precision: 3, minMove: 0.001 } : def.type === 'obv' || def.type === 'force' ? { type: 'volume' } : { type: 'price', precision: 2, minMove: 0.01 } }, index);
        if (r.bornes) se.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: r.bornes![0], maxValue: r.bornes![1] } }) });
        return se;
      });
      for (const n of r.niveaux ?? []) series[0]?.createPriceLine({ price: n, color: '#a0a0a0', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      seriesIndicateurs.current.push({ id: ind.id, series });
    }
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleIndicateurs, s]);
  useEffect(() => {
    const b = bougiesRef.current;
    g.indicateurs.forEach((ind, k) => {
      const x = seriesIndicateurs.current[k];
      if (!x || x.id !== ind.id) return;
      const r = calculer(ind, b);
      r.traces.forEach((tr, j) => {
        const se = x.series[j];
        if (!se) return;
        const donnees = tr.valeurs.flatMap((v, i) => (v === null || !b[i] ? [] : [{ time: b[i].time as UTCTimestamp, value: v, ...(tr.couleurs ? { color: tr.couleurs[i] } : {}) }]));
        se.setData(donnees);
      });
    });
    const chart = chartRef.current;
    if (chart) setHauteursPanneaux(chart.panes().map((p) => p.getHeight()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // ---------- Niveaux de trading, ligne Ask, objets ----------
  const positions = compte.positions.filter((p) => p.symbole === g.symbole);
  const ordres = compte.ordres.filter((o) => o.symbole === g.symbole);
  const cleNiveaux = JSON.stringify([positions.map((p) => [p.ticket, p.sl, p.tp, p.volume]), ordres.map((o) => [o.ticket, o.prix, o.sl, o.tp, o.type]), g.objets, g.niveauxTrading, versionSerie]);
  useEffect(() => {
    const serie = serieRef.current;
    if (!serie) return;
    const lignes: IPriceLine[] = [];
    const liste: Deplacable[] = [];
    const ajouter = (prix: number, couleur: string, titre: string, style: LineStyle, d?: Omit<Deplacable, 'ligne' | 'prix'>) => {
      const ligne = serie.createPriceLine({ price: prix, color: couleur, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: titre });
      lignes.push(ligne);
      if (d) liste.push({ ...d, prix, ligne });
    };
    if (g.niveauxTrading) {
      for (const p of positions) {
        ajouter(p.prixOuverture, p.type === 'buy' ? coul.achat : coul.vente, `#${p.ticket} ${p.type} ${p.volume.toFixed(2)}`, LineStyle.Dashed, { genre: 'position', ticket: p.ticket });
        if (p.sl) ajouter(p.sl, coul.stops, `#${p.ticket} sl`, LineStyle.Dashed, { genre: 'sl', ticket: p.ticket });
        if (p.tp) ajouter(p.tp, '#00a050', `#${p.ticket} tp`, LineStyle.Dashed, { genre: 'tp', ticket: p.ticket });
      }
      for (const o of ordres) {
        ajouter(o.prix, sensDe(o.type) === 'buy' ? coul.achat : coul.vente, `#${o.ticket} ${LIBELLES_TYPE[o.type]} ${o.volume.toFixed(2)}`, LineStyle.LargeDashed, { genre: 'ordre', ticket: o.ticket });
        if (o.sl) ajouter(o.sl, coul.stops, `#${o.ticket} sl`, LineStyle.Dotted);
        if (o.tp) ajouter(o.tp, '#00a050', `#${o.ticket} tp`, LineStyle.Dotted);
      }
    }
    const tendances: ISeriesApi<SeriesType>[] = [];
    for (const o of g.objets) {
      const [a, b] = o.points;
      if (o.type === 'horizontale') ajouter(a.prix, o.couleur, '', LineStyle.Solid, { genre: 'objet', ticket: 0, objet: o.id });
      else if (o.type === 'fibo' && b) {
        for (const n of FIBO) {
          const prix = b.prix + (a.prix - b.prix) * n;
          ajouter(Number(prix.toFixed(s.chiffres)), o.couleur, `${(n * 100).toFixed(1)}`, n === 0 || n === 1 ? LineStyle.Solid : LineStyle.Dotted);
        }
      }
    }
    deplacables.current = liste;
    return () => {
      for (const l of lignes) sansErreur(() => serie.removePriceLine(l));
      for (const se of tendances) sansErreur(() => chartRef.current?.removeSeries(se));
      deplacables.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleNiveaux, coul]);

  const ligneAsk = useRef<IPriceLine | null>(null);
  useEffect(() => {
    const serie = serieRef.current;
    if (!serie) return;
    if (!g.ligneAsk || !cot) {
      const l = ligneAsk.current;
      if (l) sansErreur(() => serie.removePriceLine(l));
      ligneAsk.current = null;
      return;
    }
    if (!ligneAsk.current) ligneAsk.current = serie.createPriceLine({ price: cot.ask, color: coul.ask, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' });
    else ligneAsk.current.applyOptions({ price: cot.ask });
  }, [cot?.ask, g.ligneAsk, coul, versionSerie]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      ligneAsk.current = null;
    },
    [versionSerie],
  );

  // Flèches des transactions passées sur ce symbole.
  const transactions = compte.transactions.filter((d) => d.symbole === g.symbole && d.type !== 'balance');
  useEffect(() => {
    const m = marqueursRef.current;
    if (!m) return;
    if (!g.historiqueTrading) return m.setMarkers([]);
    const marqueurs: SeriesMarker<Time>[] = transactions
      .map((d) => ({
        time: debutBougie(Math.floor(d.heure / 1000), g.periode) as UTCTimestamp,
        position: d.type === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
        shape: d.type === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
        color: d.type === 'buy' ? coul.achat : coul.vente,
        text: '',
        size: 0.8,
      }))
      .sort((a, b) => a.time - b.time);
    m.setMarkers(marqueurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions.length, g.historiqueTrading, g.periode, versionSerie, chargement]);

  // ---------- Glisser les lignes ----------
  const ligneProche = useCallback((y: number): Deplacable | null => {
    const serie = serieRef.current;
    if (!serie) return null;
    let meilleur: Deplacable | null = null;
    let distance = 6;
    for (const d of deplacables.current) {
      const yy = serie.priceToCoordinate(d.prix);
      if (yy === null) continue;
      const e = Math.abs(yy - y);
      if (e <= distance) {
        distance = e;
        meilleur = d;
      }
    }
    return meilleur;
  }, []);

  useEffect(() => {
    const el = conteneur.current!;
    const yDe = (e: PointerEvent | MouseEvent) => e.clientY - el.getBoundingClientRect().top;
    const xDe = (e: PointerEvent | MouseEvent) => e.clientX - el.getBoundingClientRect().left;
    // Seule la zone du graphique principal (hors échelle des prix et sous-fenêtres) accepte le glisser.
    const dansPrincipal = (e: PointerEvent | MouseEvent) => {
      const chart = chartRef.current;
      if (!chart) return false;
      const h = chart.panes()[0]?.getHeight() ?? 0;
      return yDe(e) < h && xDe(e) < el.clientWidth - chart.priceScale('right').width();
    };
    let image = 0;
    const bas = (e: PointerEvent) => {
      if (e.button !== 0 || refEtat.current.outil || !dansPrincipal(e)) return;
      // Poignée d'un objet (tendance, Fibonacci, rectangle, canal, verticale, texte) : on tire ce point.
      const dessins = dessinsRef.current;
      let ancre: { id: string; index: number; depart?: { t: number; prix: number }; points?: { t: number; prix: number }[] } | null = dessins?.ancreProche(xDe(e), yDe(e)) ?? null;
      if (!ancre && dessins) {
        // Tracé de l'objet : on le déplace d'un bloc.
        const id = dessins.corpsProche(xDe(e), yDe(e));
        const o = id ? refEtat.current.g.objets.find((x) => x.id === id) : undefined;
        const t = dessins.tempsEn(xDe(e));
        const prix = serieRef.current?.coordinateToPrice(yDe(e));
        if (o && t !== null && prix !== null && prix !== undefined) ancre = { id: o.id, index: -1, depart: { t, prix }, points: o.points };
      }
      if (ancre) {
        e.stopPropagation();
        e.preventDefault();
        glisseObjet.current = ancre;
        dessinsRef.current?.selectionner(ancre.id);
        chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
        el.setPointerCapture(e.pointerId);
        return;
      }
      const d = ligneProche(yDe(e));
      // Appui long au doigt (mobile) : menu « trader à ce prix » au prix pointé.
      if (!d && e.pointerType === 'touch' && refEtat.current.appuiLong) {
        const y = yDe(e);
        appui.current = { x: e.clientX, y: e.clientY };
        window.clearTimeout(minuteurAppui.current);
        minuteurAppui.current = window.setTimeout(() => {
          appui.current = null;
          const prix = serieRef.current?.coordinateToPrice(y);
          if (prix !== null && prix !== undefined) refEtat.current.appuiLong?.(prix);
        }, 600);
      }
      if (!d) return;
      e.stopPropagation();
      e.preventDefault();
      glisse.current = { d, prix: d.prix };
      // Doigt immobile 600 ms sur une ligne : ouverture de la modification au lieu du glisser.
      if (e.pointerType === 'touch' && refEtat.current.appuiLigne && d.genre !== 'objet') {
        appui.current = { x: e.clientX, y: e.clientY };
        window.clearTimeout(minuteurAppui.current);
        minuteurAppui.current = window.setTimeout(() => {
          appui.current = null;
          const gl = glisse.current;
          if (!gl) return;
          gl.d.ligne.applyOptions({ price: gl.d.prix });
          glisse.current = null;
          chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
          refEtat.current.appuiLigne?.(gl.d.genre === 'ordre' ? 'ordre' : 'position', gl.d.ticket);
        }, 600);
      }
      chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
      el.setPointerCapture(e.pointerId);
    };
    const bouge = (e: PointerEvent) => {
      const a = appui.current;
      if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 10) {
        appui.current = null;
        window.clearTimeout(minuteurAppui.current);
      }
      const go = glisseObjet.current;
      if (go) {
        e.stopPropagation();
        const x = xDe(e);
        const y = yDe(e);
        cancelAnimationFrame(image);
        image = requestAnimationFrame(() => {
          const t = dessinsRef.current?.tempsEn(x);
          const prix = serieRef.current?.coordinateToPrice(y);
          if (t === null || t === undefined || prix === null || prix === undefined) return;
          const sy = symbole(refEtat.current.g.symbole)!;
          const arrondi = (v: number) => Number(v.toFixed(sy.chiffres));
          const nouveaux = (o: ObjetGraphique) =>
            go.index >= 0
              ? o.points.map((p, i) => (i === go.index ? { t, prix: arrondi(prix) } : p))
              : (go.points ?? o.points).map((p) => ({ t: p.t + (t - go.depart!.t), prix: arrondi(p.prix + (prix - go.depart!.prix)) }));
          majGraphique(refEtat.current.g.id, (gr) => ({ objets: gr.objets.map((o) => (o.id === go.id ? { ...o, points: nouveaux(o) } : o)) }));
        });
        return;
      }
      const gl = glisse.current;
      if (!gl) {
        const libre = !refEtat.current.outil && dansPrincipal(e);
        const ancre = libre ? dessinsRef.current?.ancreProche(xDe(e), yDe(e)) : null;
        const corps = libre && !ancre ? dessinsRef.current?.corpsProche(xDe(e), yDe(e)) : null;
        dessinsRef.current?.selectionner(ancre?.id ?? corps ?? null);
        el.style.cursor = ancre ? 'crosshair' : corps ? 'move' : libre && ligneProche(yDe(e)) ? 'ns-resize' : refEtat.current.outil ? 'crosshair' : '';
        return;
      }
      e.stopPropagation();
      const prix = serieRef.current?.coordinateToPrice(yDe(e));
      if (prix === null || prix === undefined) return;
      const sy = symbole(refEtat.current.g.symbole)!;
      gl.prix = Number(prix.toFixed(sy.chiffres));
      gl.d.ligne.applyOptions({ price: gl.prix });
    };
    const haut = (e: PointerEvent) => {
      appui.current = null;
      window.clearTimeout(minuteurAppui.current);
      if (glisseObjet.current) {
        e.stopPropagation();
        glisseObjet.current = null;
        chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
        el.releasePointerCapture(e.pointerId);
        return;
      }
      const gl = glisse.current;
      if (!gl) return;
      e.stopPropagation();
      glisse.current = null;
      chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
      el.releasePointerCapture(e.pointerId);
      const { d, prix } = gl;
      if (Math.abs(prix - d.prix) < 1e-12) return;
      const { compte: c } = refEtat.current;
      const remettre = () => d.ligne.applyOptions({ price: d.prix });
      if (d.genre === 'objet') {
        majGraphique(refEtat.current.g.id, (gr) => ({ objets: gr.objets.map((o) => (o.id === d.objet ? { ...o, points: [{ ...o.points[0], prix }, ...o.points.slice(1)] } : o)) }));
        return;
      }
      if (d.genre === 'ordre') {
        const o = c.ordres.find((x) => x.ticket === d.ticket);
        if (!o) return remettre();
        // L'ordre garde la même distance à son stop-loss / take-profit.
        const ecart = prix - o.prix;
        const r = operer((cc) => modifierOrdre(cc, o.ticket, { prix, prixLimite: o.prixLimite ? o.prixLimite + ecart : 0, sl: o.sl ? o.sl + ecart : 0, tp: o.tp ? o.tp + ecart : 0, expiration: o.expiration, echeance: o.echeance }, refEtat.current.cotations));
        if (r.erreur) remettre();
        return;
      }
      const p = c.positions.find((x) => x.ticket === d.ticket);
      if (!p) return remettre();
      let sl = p.sl;
      let tp = p.tp;
      if (d.genre === 'sl') sl = prix;
      else if (d.genre === 'tp') tp = prix;
      else {
        // Tirer la ligne d'ouverture crée un stop-loss (côté perte) ou un take-profit (côté gain), comme dans MT5.
        const gain = p.type === 'buy' ? prix > p.prixOuverture : prix < p.prixOuverture;
        if (gain) tp = prix;
        else sl = prix;
        remettre();
      }
      const r = operer((cc) => modifierPosition(cc, p.ticket, sl, tp, refEtat.current.cotations));
      if (r.erreur && d.genre !== 'position') remettre();
    };
    const double = (e: MouseEvent) => {
      if (!dansPrincipal(e)) return;
      const id = dessinsRef.current?.ancreProche(xDe(e), yDe(e))?.id ?? dessinsRef.current?.corpsProche(xDe(e), yDe(e));
      if (id) {
        e.stopPropagation();
        return ouvrir({ type: 'objet', graphique: refEtat.current.g.id, id });
      }
      const d = ligneProche(yDe(e));
      if (!d) return;
      e.stopPropagation();
      if (d.genre === 'ordre') ouvrir({ type: 'modifier-ordre', ticket: d.ticket });
      else if (d.genre !== 'objet') ouvrir({ type: 'modifier-position', ticket: d.ticket });
    };
    el.addEventListener('pointerdown', bas, true);
    el.addEventListener('pointermove', bouge, true);
    el.addEventListener('pointerup', haut, true);
    el.addEventListener('dblclick', double, true);
    return () => {
      el.removeEventListener('pointerdown', bas, true);
      el.removeEventListener('pointermove', bouge, true);
      el.removeEventListener('pointerup', haut, true);
      el.removeEventListener('dblclick', double, true);
    };
  }, [ligneProche, majGraphique, operer, ouvrir]);

  // ---------- Menu contextuel ----------
  const menuGraphique = (e: React.MouseEvent) => {
    e.preventDefault();
    activer();
    const el = conteneur.current!;
    const y = e.clientY - el.getBoundingClientRect().top;
    const prixBrut = serieRef.current?.coordinateToPrice(y);
    const prix = prixBrut !== null && prixBrut !== undefined ? Number(prixBrut.toFixed(s.chiffres)) : undefined;
    if (appuiLong) {
      // Le menu mobile passe par l'appui long au doigt ; à la souris (cadre de téléphone), par le clic droit.
      if ((e.nativeEvent as PointerEvent).pointerType !== 'touch' && prix !== undefined) appuiLong(prix);
      return;
    }
    const d = ligneProche(y);
    const v = volume;
    const elements: ElementMenu[] = [];
    const ancre = dessinsRef.current?.ancreProche(e.clientX - el.getBoundingClientRect().left, y);
    const objet = g.objets.find((o) => o.id === (ancre?.id ?? dessinsRef.current?.corpsProche(e.clientX - el.getBoundingClientRect().left, y) ?? (d?.genre === 'objet' ? d.objet : undefined)));
    if (objet) {
      elements.push(
        { libelle: `Supprimer : ${OBJETS[objet.type].nom}${objet.texte ? ` « ${objet.texte} »` : ''}`, action: () => majGraphique(g.id, (gr) => ({ objets: gr.objets.filter((o) => o.id !== objet.id) })) },
        ...(objet.type === 'texte'
          ? [
              {
                libelle: 'Modifier le texte…',
                action: () => {
                  const texte = window.prompt('Texte', objet.texte ?? '')?.trim();
                  if (texte) majGraphique(g.id, (gr) => ({ objets: gr.objets.map((o) => (o.id === objet.id ? { ...o, texte: texte.slice(0, 80) } : o)) }));
                },
              },
            ]
          : []),
        { libelle: 'Propriétés…', action: () => ouvrir({ type: 'objet', graphique: g.id, id: objet.id }) },
        { libelle: 'Liste des objets…', raccourci: 'Ctrl+B', action: () => ouvrir({ type: 'objets', graphique: g.id }) },
        { separateur: true },
      );
    }
    if (d && d.genre !== 'objet') {
      const p = compte.positions.find((x) => x.ticket === d.ticket);
      const o = compte.ordres.find((x) => x.ticket === d.ticket);
      if (p) {
        elements.push(
          { libelle: `Fermer la position #${p.ticket}`, action: () => operer((c) => fermerPosition(c, p.ticket, cotations)) },
          { libelle: 'Modifier la position…', action: () => ouvrir({ type: 'modifier-position', ticket: p.ticket }) },
        );
        if (d.genre === 'sl') elements.push({ libelle: 'Supprimer le Stop Loss', action: () => operer((c) => modifierPosition(c, p.ticket, 0, p.tp, cotations)) });
        if (d.genre === 'tp') elements.push({ libelle: 'Supprimer le Take Profit', action: () => operer((c) => modifierPosition(c, p.ticket, p.sl, 0, cotations)) });
      }
      if (o) {
        elements.push(
          { libelle: `Supprimer l'ordre #${o.ticket}`, action: () => operer((c) => supprimerOrdre(c, o.ticket)) },
          { libelle: "Modifier l'ordre…", action: () => ouvrir({ type: 'modifier-ordre', ticket: o.ticket }) },
        );
      }
      elements.push({ separateur: true });
    }
    // Sous-menu « Trading » : ordres en attente au prix pointé, selon sa position par rapport au marché.
    const trading: ElementMenu[] = [
      { libelle: 'Achat au marché', action: () => operer((c) => ouvrirMarche(c, { symbole: g.symbole, type: 'buy', volume: v, sl: 0, tp: 0, commentaire: '' }, cotations), { confirmation: false }) },
      { libelle: 'Vente au marché', action: () => operer((c) => ouvrirMarche(c, { symbole: g.symbole, type: 'sell', volume: v, sl: 0, tp: 0, commentaire: '' }, cotations), { confirmation: false }) },
    ];
    if (prix && cot) {
      const attente = (type: TypeEnAttente): ElementMenu => ({
        libelle: `${LIBELLES_TYPE[type].replace(/^./, (x) => x.toUpperCase())} ${v.toFixed(2)} à ${formaterPrix(s, prix)}`,
        action: () => ouvrir({ type: 'ordre', symbole: g.symbole, attente: type, prix, volume: v }),
      });
      trading.push({ separateur: true });
      if (prix < cot.bid) trading.push(attente('buy_limit'), attente('sell_stop'));
      else if (prix > cot.ask) trading.push(attente('sell_limit'), attente('buy_stop'));
    }
    trading.push({ separateur: true }, { libelle: 'Nouvel ordre…', raccourci: 'F9', action: () => ouvrir({ type: 'ordre', symbole: g.symbole }) });
    elements.push(
      { libelle: 'Trading', sousMenu: trading },
      { libelle: 'Trading en un clic', raccourci: 'Alt+T', coche: g.unClic, action: () => majGraphique(g.id, { unClic: !g.unClic }) },
      { libelle: 'Profondeur du marché', raccourci: 'Alt+B', desactive: !s.direct.binance, action: () => ouvrir({ type: 'profondeur', symbole: g.symbole }) },
      { separateur: true },
      { libelle: 'Période', sousMenu: PERIODES.map((p) => ({ libelle: p.libelle, raccourci: p.id, coche: g.periode === p.id, action: () => majGraphique(g.id, { periode: p.id }) })) },
      {
        libelle: 'Type',
        sousMenu: [
          { libelle: 'Barres', raccourci: 'Alt+1', coche: g.type === 'barres', action: () => majGraphique(g.id, { type: 'barres' }) },
          { libelle: 'Bougies japonaises', raccourci: 'Alt+2', coche: g.type === 'bougies', action: () => majGraphique(g.id, { type: 'bougies' }) },
          { libelle: 'Ligne', raccourci: 'Alt+3', coche: g.type === 'ligne', action: () => majGraphique(g.id, { type: 'ligne' }) },
        ],
      },
      { libelle: 'Modèle', sousMenu: menuModeles(etat, t.maj, g) },
      {
        libelle: 'Expert Advisors',
        sousMenu: [
          { libelle: g.expert ? 'Propriétés…' : 'Attacher un expert…', action: () => ouvrir({ type: 'expert', graphique: g.id, expert: g.expert?.type }) },
          { libelle: 'Retirer', desactive: !g.expert, action: () => majGraphique(g.id, { expert: null }) },
        ],
      },
      { libelle: 'Liste des indicateurs', raccourci: 'Ctrl+I', action: () => ouvrir({ type: 'liste-indicateurs', graphique: g.id }) },
      { libelle: 'Liste des objets', raccourci: 'Ctrl+B', action: () => ouvrir({ type: 'objets', graphique: g.id }) },
      { libelle: 'Supprimer tous les objets', desactive: g.objets.length === 0, action: () => majGraphique(g.id, { objets: [] }) },
      { separateur: true },
      { libelle: 'Grille', raccourci: 'Ctrl+G', coche: g.grille, action: () => majGraphique(g.id, { grille: !g.grille }) },
      { libelle: 'Volumes', raccourci: 'Ctrl+L', coche: g.indicateurs.some((i) => i.type === 'volumes'), action: () => basculerVolumes() },
      { libelle: 'Ligne Ask', coche: g.ligneAsk, action: () => majGraphique(g.id, { ligneAsk: !g.ligneAsk }) },
      { separateur: true },
      { libelle: 'Rafraîchir', action: () => setRechargement((x) => x + 1) },
      { libelle: 'Enregistrer comme image', action: () => registreGraphiques.get(g.id)?.capturer() },
      { libelle: 'Propriétés…', raccourci: 'F8', action: () => ouvrir({ type: 'proprietes', graphique: g.id }) },
    );
    ouvrirMenu(e.clientX, e.clientY, elements);
  };

  const basculerVolumes = () =>
    majGraphique(g.id, (gr) => ({
      indicateurs: gr.indicateurs.some((i) => i.type === 'volumes')
        ? gr.indicateurs.filter((i) => i.type !== 'volumes')
        : [...gr.indicateurs, { id: identifiant(), type: 'volumes', p: {}, couleur: '#32cd32' }],
    }));

  const unClic = (sens: 'buy' | 'sell') => {
    if (!etat.unClicAccepte) return ouvrir({ type: 'unclic' });
    operer((c) => ouvrirMarche(c, { symbole: g.symbole, type: sens, volume, sl: 0, tp: 0, commentaire: '' }, cotations), { confirmation: false });
  };

  const superposes = g.indicateurs.filter((i) => definition(i.type).superpose);
  const sousFenetres = g.indicateurs.filter((i) => !definition(i.type).superpose);
  const periode = PERIODES.find((p) => p.id === g.periode)!;

  return (
    <div className={`graphique${actif ? ' actif' : ''}`} onMouseDown={activer} style={{ background: coul.fond, color: coul.texte }}>
      <div ref={conteneur} className="graphique-zone" onContextMenu={menuGraphique} />
      <div className="graphique-entete">
        <div className="graphique-titre">
          {g.symbole}, {g.periode} : {s.description}
        </div>
        {g.unClic && (
          <div className="un-clic" onMouseDown={(e) => e.stopPropagation()}>
            <button className="uc-vente" onClick={() => unClic('sell')} title="Vendre au marché">
              <span className="uc-libelle">SELL</span>
              <PrixGros s={s} prix={cot?.bid} />
            </button>
            <div className="uc-volume">
              <VolumeRapide valeur={volume} changer={setVolume} pas={s.pasVolume} min={s.volumeMin} max={s.volumeMax} />
              {cot && <span className="uc-spread">spread {Math.round((cot.ask - cot.bid) / point(s))}</span>}
            </div>
            <button className="uc-achat" onClick={() => unClic('buy')} title="Acheter au marché">
              <span className="uc-libelle">BUY</span>
              <PrixGros s={s} prix={cot?.ask} />
            </button>
          </div>
        )}
        {superposes.map((i) => (
          <div key={i.id} className="graphique-indicateur" style={{ color: i.couleur }} onDoubleClick={() => ouvrir({ type: 'indicateur', indicateur: i.type, graphique: g.id, existant: i.id })}>
            {nomCourt(i)}
          </div>
        ))}
      </div>
      {g.expert && (
        <button
          className={`graphique-expert${etat.algo ? ' actif' : ''}`}
          title={etat.algo ? 'Expert actif — cliquez pour ses propriétés' : "Algo Trading désactivé : l'expert ne trade pas"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => ouvrir({ type: 'expert', graphique: g.id, expert: g.expert!.type })}
        >
          <svg viewBox="0 0 20 20" width="14" height="14">
            <path d="M10 3l8 4-8 4-8-4z" fill="currentColor" />
            <path d="M5 9v4c0 1.5 2.5 3 5 3s5-1.5 5-3V9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {definitionExpert(g.expert.type).nom}
        </button>
      )}
      {sousFenetres.map((i, k) => {
        const haut = hauteursPanneaux.slice(0, k + 1).reduce((a, b) => a + b + 1, 0);
        return (
          <div key={i.id} className="graphique-indicateur sous" style={{ top: haut + 2, color: coul.texte }} onDoubleClick={() => ouvrir({ type: 'indicateur', indicateur: i.type, graphique: g.id, existant: i.id })}>
            {nomCourt(i)}
          </div>
        );
      })}
      {chargement === 'en-cours' && <div className="graphique-message">Chargement de l'historique {g.symbole}, {periode.libelle.toLowerCase()}…</div>}
      {chargement === 'vide' && bougiesRef.current.length === 0 && <div className="graphique-message">En attente de cotations pour {g.symbole}…</div>}
      {outil && actif && (
        <div className="graphique-outil">
          {OBJETS[outil].nom} : {etape === 0 ? 'cliquez sur le graphique pour placer l\'objet' : outil === 'canal' && etape === 2 ? 'cliquez pour la largeur du canal' : 'cliquez sur le point suivant'} — Échap pour annuler
        </div>
      )}
      {menu}
    </div>
  );
}
