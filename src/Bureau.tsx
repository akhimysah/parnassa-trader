import { useRef } from 'react';
import { useTerminal } from './contexte';
import { BarreEtat, BarreMenus, BarreOutils } from './composants/Barres';
import { ObservationMarche } from './composants/ObservationMarche';
import { Navigateur } from './composants/Navigateur';
import { FenetreDonnees } from './composants/FenetreDonnees';
import { BoiteOutils, type OngletBoite } from './composants/BoiteOutils';
import { ZoneGraphiques } from './composants/ZoneGraphiques';
import { Testeur } from './composants/Testeur';

/** Terminal de bureau (chargé à part : le téléphone ne télécharge que l'interface mobile). */
export default function Bureau({ texteSurvol, onglet, changerOnglet }: { texteSurvol: string; onglet: OngletBoite; changerOnglet: (o: OngletBoite) => void }) {
  const { etat } = useTerminal();
  const p = etat.panneaux;
  return (
        <div className="terminal">
          <BarreMenus />
          {p.barreOutils && <BarreOutils />}
          <div className="corps">
            {(p.observation || p.navigateur || p.donnees) && (
              <aside className="colonne-gauche">
                {p.observation && <ObservationMarche />}
                {p.donnees && <FenetreDonnees />}
                {p.navigateur && <Navigateur />}
              </aside>
            )}
            <div className="centre">
              <ZoneGraphiques />
              {(p.boite || p.testeur) && (
                <div className="boite-cadre" style={{ height: etat.hauteurBoite }}>
                  <Poignee />
                  {/* Comme dans MT5, le testeur de stratégie occupe le bas de la fenêtre à la place de la boîte à outils. */}
                  {p.testeur ? <Testeur /> : <BoiteOutils onglet={onglet} changer={changerOnglet} />}
                </div>
              )}
            </div>
          </div>
          {p.barreEtat && <BarreEtat texteSurvol={texteSurvol} />}
        </div>
  );
}

/** Poignée de redimensionnement de la Boîte à outils. */
function Poignee() {
  const { maj, etat } = useTerminal();
  const depart = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      className="poignee"
      onPointerDown={(e) => {
        depart.current = { y: e.clientY, h: etat.hauteurBoite };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = depart.current;
        if (d) maj((x) => ({ ...x, hauteurBoite: Math.max(90, Math.min(window.innerHeight - 220, d.h - (e.clientY - d.y))) }));
      }}
      onPointerUp={() => {
        depart.current = null;
      }}
    />
  );
}

