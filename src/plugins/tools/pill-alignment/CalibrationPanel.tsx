// Chassis calibration editor (plan 0011). Real OTK eccentricities aren't
// published, so every constant is editable; presets are approximate starting
// points and any hand edit detaches the preset.

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToolsT, type ToolsKey } from "../i18n";
import { NumRow } from "../shared/NumRow";
import { CHASSIS_PRESETS, type PillCalibration } from "./model";

interface CalibrationPanelProps {
  cal: PillCalibration;
  presetId: string | null;
  onChange: (cal: PillCalibration, presetId: string | null) => void;
}

const PRESET_NAME_KEYS: Record<string, ToolsKey> = {
  generic: "pill.cal.presetGeneric",
  "otk-approx": "pill.cal.presetOtk",
};

export function CalibrationPanel({ cal, presetId, onChange }: CalibrationPanelProps) {
  const t = useToolsT();
  const edit = (patch: Partial<PillCalibration>) => onChange({ ...cal, ...patch }, null);
  const editE = (i: number, v: number) => {
    const eMm = [...cal.eMm] as PillCalibration["eMm"];
    eMm[i] = Math.max(v, 0);
    edit({ eMm });
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">{t("pill.cal.disclaimer")}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">{t("pill.cal.preset")}</Label>
          <Select
            value={presetId ?? "custom"}
            onValueChange={(id) => {
              const preset = CHASSIS_PRESETS.find((p) => p.id === id);
              if (preset) onChange({ ...preset.cal }, preset.id);
            }}
          >
            <SelectTrigger className="h-8 w-44 mt-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHASSIS_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {t(PRESET_NAME_KEYS[p.id])}
                </SelectItem>
              ))}
              {presetId === null && (
                <SelectItem value="custom" disabled>
                  {t("pill.cal.presetCustom")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        {presetId === null && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => onChange({ ...CHASSIS_PRESETS[0].cal }, CHASSIS_PRESETS[0].id)}
          >
            {t("pill.cal.resetPreset")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <NumRow label={t("pill.cal.h")} unit="mm" value={cal.hMm} onChange={(v) => edit({ hMm: Math.max(v, 10) })} />
        <NumRow label={t("pill.cal.lRim")} unit="mm" value={cal.lRimMm} onChange={(v) => edit({ lRimMm: Math.max(v, 10) })} step={5} />
        <NumRow label={t("pill.cal.split")} unit="0–1" value={cal.wheelFrac} onChange={(v) => edit({ wheelFrac: Math.min(Math.max(v, 0), 1) })} step={0.05} />
        <NumRow label={t("pill.cal.neutralX")} unit="mm" value={cal.nXMm} onChange={(v) => edit({ nXMm: v })} step={0.1} />
        <NumRow label={t("pill.cal.neutralY")} unit="mm" value={cal.nYMm} onChange={(v) => edit({ nYMm: v })} step={0.1} />
        <NumRow label={t("pill.cal.gamma0")} unit="°" value={cal.gamma0Deg} onChange={(v) => edit({ gamma0Deg: v })} step={0.1} />
        <NumRow label={t("pill.cal.holeCount")} value={cal.holeCount} onChange={(v) => edit({ holeCount: Math.max(Math.round(v), 0) })} />
        <NumRow label={t("pill.cal.toeCoupling")} unit="mm/mm" value={cal.toeCouplingMmPerMm} onChange={(v) => edit({ toeCouplingMmPerMm: v })} step={0.1} />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">{t("pill.cal.eccentricity")}</Label>
        <div className="mt-1 grid grid-cols-3 sm:grid-cols-6 gap-3">
          {cal.eMm.map((e, i) => (
            <NumRow
              key={i}
              label={`e${i}`}
              unit="mm"
              value={e}
              step={0.1}
              onChange={(v) => editE(i, v)}
              // e0 is concentric by definition; editing it would break the solver's degenerate cases.
              className={i === 0 ? "pointer-events-none opacity-50" : undefined}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={cal.signCamber === -1} onCheckedChange={(v) => edit({ signCamber: v ? -1 : 1 })} />
          {t("pill.cal.signCamber")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={cal.signCaster === -1} onCheckedChange={(v) => edit({ signCaster: v ? -1 : 1 })} />
          {t("pill.cal.signCaster")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={cal.mirrorRight} onCheckedChange={(v) => edit({ mirrorRight: v })} />
          {t("pill.cal.mirrorRight")}
        </label>
      </div>
    </div>
  );
}
