// "Find Setup" inverse-solver panel (plan 0011): target camber/caster in,
// ranked pill combinations out, one tap to apply.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToolsT } from "../i18n";
import { NumRow } from "../shared/NumRow";
import { findSetups, DEFAULT_SOLVE_OPTIONS, type SetupCandidate } from "./inverse";
import { holeIndex, type CornerPills, type PillCalibration, type Side } from "./model";

interface FindSetupPanelProps {
  cal: PillCalibration;
  side: Side;
  snapHoles: boolean;
  currentCasterDeg: number;
  /** Seed values pulled from the session setup, if any. */
  seedCamberDeg?: number | null;
  seedCasterDeg?: number | null;
  onApply: (pills: CornerPills) => void;
}

export function FindSetupPanel({ cal, side, snapHoles, currentCasterDeg, seedCamberDeg, seedCasterDeg, onApply }: FindSetupPanelProps) {
  const t = useToolsT();
  const [camber, setCamber] = useState(seedCamberDeg ?? 0);
  const [caster, setCaster] = useState<number | null>(seedCasterDeg ?? null);
  const [results, setResults] = useState<SetupCandidate[] | null>(null);

  const solve = () => {
    setResults(
      findSetups(cal, { camberDeg: camber, casterDeg: caster ?? currentCasterDeg }, side, {
        ...DEFAULT_SOLVE_OPTIONS,
        snapHoles,
      }),
    );
  };

  const angleText = (deg: number) =>
    cal.holeCount > 0 ? `${Math.round(deg)}° · #${holeIndex(deg, cal.holeCount)}` : `${Math.round(deg)}°`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <NumRow label={t("pill.findSetup.targetCamber")} unit="°" step={0.1} value={camber} onChange={setCamber} />
        <NumRow
          label={t("pill.findSetup.targetCaster")}
          unit="°"
          step={0.1}
          value={caster ?? currentCasterDeg}
          onChange={setCaster}
        />
      </div>
      <Button size="sm" className="h-8" onClick={solve}>
        {t("pill.findSetup.solve")}
      </Button>
      {results !== null && (
        <div className="space-y-1.5">
          {results.length === 0 && <p className="text-xs text-muted-foreground">{t("pill.findSetup.noResults")}</p>}
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded border border-border px-2.5 py-1.5 text-xs"
            >
              <div className="min-w-0 font-mono tabular-nums">
                <p className="text-foreground">
                  {t("pill.findSetup.top")} {r.pills.sTop} @ {angleText(r.pills.thetaTopDeg)} ·{" "}
                  {t("pill.findSetup.bottom")} {r.pills.sBot} @ {angleText(r.pills.thetaBotDeg)}
                </p>
                <p className="text-muted-foreground">
                  {r.result.camberDeg.toFixed(2)}° / {r.result.casterDeg.toFixed(2)}° ·{" "}
                  {t("pill.findSetup.residual")} {r.residualDeg.toFixed(2)}° · Δ{r.result.trackDeltaMm.toFixed(1)}mm
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => onApply(r.pills)}>
                {t("pill.findSetup.apply")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
