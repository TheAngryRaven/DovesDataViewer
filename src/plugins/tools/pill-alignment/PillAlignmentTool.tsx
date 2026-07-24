// Pill alignment calculator (plan 0011) — eccentric kingpin pills → camber /
// caster / track width, with an inverse "Find Setup" solver.
//
// All geometry lives in the pure model/inverse/envelope/toe modules; this file
// is rendering + state. Settings persist to the tools plugin store so a
// calibrated chassis survives reloads and works fully offline trackside. The
// tool renders identically in-session and on the landing page — the only
// session tie-in is the optional "load from setup" seed.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";
import type { PluginPanelProps } from "@/plugins/panels";
import { getPluginStore } from "@/plugins/storage";
import { getTemplate } from "@/lib/templateStorage";
import { useToolsT, type ToolsKey } from "../i18n";
import { NumRow, Section } from "../shared/NumRow";
import {
  DEFAULT_STATE,
  forwardCorner,
  holeIndex,
  normalizeDeg,
  snapToHole,
  PILL_SIZES,
  type CornerPills,
  type EnvelopeColorMode,
  type PersistedStateV1,
  type PillSize,
  type Side,
} from "./model";
import { nearestAngles } from "./inverse";
import { singlePillLoci, sweepEnvelope } from "./envelope";
import { resolveSetupAlignmentFields, type SetupAlignmentValues } from "./toe";
import {
  makeUserProfile,
  migrateProfileId,
  removeUserProfile,
  upsertUserProfile,
  type ChassisProfile,
} from "./profiles";
import { EnvelopePlot } from "./EnvelopePlot";
import { PillDial } from "./PillDial";
import { FindSetupPanel } from "./FindSetupPanel";
import { OverheadToeView } from "./OverheadToeView";
import { CalibrationPanel } from "./CalibrationPanel";

const STORE_KEY = "pill-alignment:v1";
const PROFILES_KEY = "pill-alignment:profiles:v1";

const COLOR_MODE_KEYS: Record<EnvelopeColorMode, ToolsKey> = {
  trackDelta: "pill.colorMode.trackDelta",
  thetaTop: "pill.colorMode.thetaTop",
  resultantToe: "pill.colorMode.resultantToe",
};

function signed(value: number, digits: number): string {
  const r = value.toFixed(digits);
  return value >= 0 ? `+${r}` : r.replace("-", "−");
}

export default function PillAlignmentTool({ sessionSetup }: PluginPanelProps) {
  const t = useToolsT();
  const settings = useOptionalSettingsContext();
  const darkMode = settings?.darkMode ?? true;
  const store = useMemo(() => getPluginStore("tools"), []);

  const [state, setState] = useState<PersistedStateV1>(DEFAULT_STATE);
  const [userProfiles, setUserProfiles] = useState<ChassisProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [setupSeed, setSetupSeed] = useState<SetupAlignmentValues | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      store.get<PersistedStateV1 & { presetId?: string | null }>(STORE_KEY),
      store.get<ChassisProfile[]>(PROFILES_KEY),
    ])
      .then(([saved, profiles]) => {
        if (!active) return;
        if (saved) {
          setState({
            ...DEFAULT_STATE,
            ...saved,
            profileId: migrateProfileId(saved.profileId ?? saved.presetId),
            calibration: { ...DEFAULT_STATE.calibration, ...saved.calibration },
            corners: {
              left: { ...DEFAULT_STATE.corners.left, ...saved.corners?.left },
              right: { ...DEFAULT_STATE.corners.right, ...saved.corners?.right },
            },
            toe: { ...DEFAULT_STATE.toe, ...saved.toe },
          });
        }
        if (profiles) setUserProfiles(profiles);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [store]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      void store.set(STORE_KEY, state satisfies PersistedStateV1).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [state, loaded, store]);

  useEffect(() => {
    if (!loaded) return;
    void store.set(PROFILES_KEY, userProfiles).catch(() => undefined);
  }, [userProfiles, loaded, store]);

  const { calibration: cal, corners, linked, activeSide, colorMode, snapHoles, toe } = state;
  const active = corners[activeSide];

  const setCorner = (side: Side, pills: CornerPills) =>
    setState((s) => ({
      ...s,
      corners: s.linked ? { left: pills, right: pills } : { ...s.corners, [side]: pills },
    }));

  const results = useMemo(
    () => ({
      left: forwardCorner(cal, corners.left, "left"),
      right: forwardCorner(cal, corners.right, "right"),
    }),
    [cal, corners],
  );

  const envelope = useMemo(
    () => sweepEnvelope(cal, active.sTop, active.sBot, activeSide),
    [cal, active.sTop, active.sBot, activeSide],
  );
  const loci = useMemo(
    () => singlePillLoci(cal, active.sTop, active.sBot, activeSide),
    [cal, active.sTop, active.sBot, activeSide],
  );

  const onEnvelopeTarget = (camberDeg: number, casterDeg: number) =>
    setCorner(activeSide, nearestAngles(cal, active, { camberDeg, casterDeg }, activeSide, snapHoles));

  const loadFromSetup = async () => {
    if (!sessionSetup) return;
    const template = await getTemplate(sessionSetup.templateId).catch(() => null);
    const values = resolveSetupAlignmentFields(template, sessionSetup.customFields);
    setSetupSeed(values);
    if (values.toe !== null) {
      const toeMm = values.toe;
      setState((s) => ({ ...s, toe: { ...s.toe, mode: "perSide", leftToeMm: toeMm, rightToeMm: toeMm } }));
    }
  };

  const stepDeg = cal.holeCount > 0 ? 360 / cal.holeCount : 5;

  const dialCell = (side: Side, bore: "top" | "bot") => {
    const pills = corners[side];
    const size = bore === "top" ? pills.sTop : pills.sBot;
    const angle = bore === "top" ? pills.thetaTopDeg : pills.thetaBotDeg;
    const setAngle = (deg: number) =>
      setCorner(side, bore === "top" ? { ...pills, thetaTopDeg: deg } : { ...pills, thetaBotDeg: deg });
    const setSize = (s: PillSize) =>
      setCorner(side, bore === "top" ? { ...pills, sTop: s } : { ...pills, sBot: s });
    const mirrored = linked && side === "right";
    const label = t(
      bore === "top"
        ? side === "left"
          ? "pill.dial.topLeft"
          : "pill.dial.topRight"
        : side === "left"
          ? "pill.dial.bottomLeft"
          : "pill.dial.bottomRight",
    );

    return (
      <div className="rounded-lg border border-border bg-card p-2.5 space-y-1.5">
        <p className="text-[11px] font-medium text-center text-muted-foreground">{label}</p>
        <PillDial
          side={side}
          size={size}
          angleDeg={angle}
          holeCount={cal.holeCount}
          snap={snapHoles}
          eccentricityMm={cal.eMm[size]}
          maxEccentricityMm={cal.eMm[cal.eMm.length - 1]}
          onAngle={(deg) => setAngle(snapHoles ? snapToHole(deg, cal.holeCount) : deg)}
          ariaLabel={t("pill.dial.aria", { label })}
          disabled={mirrored}
        />
        <div className="flex items-center gap-1.5">
          <Select value={String(size)} onValueChange={(v) => setSize(Number(v) as PillSize)} disabled={mirrored}>
            <SelectTrigger className="h-7 w-14 text-xs" aria-label={t("pill.dial.size")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PILL_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 px-0"
            disabled={mirrored}
            onClick={() => setAngle(normalizeDeg(angle - stepDeg))}
          >
            −
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 px-0"
            disabled={mirrored}
            onClick={() => setAngle(normalizeDeg(angle + stepDeg))}
          >
            +
          </Button>
          <span className="ml-auto text-xs font-mono tabular-nums text-foreground">
            {Math.round(normalizeDeg(angle))}°
            {cal.holeCount > 0 && <span className="text-muted-foreground"> #{holeIndex(angle, cal.holeCount)}</span>}
          </span>
        </div>
      </div>
    );
  };

  const readoutRow = (side: Side) => {
    const r = results[side];
    return (
      <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
        <span className="text-muted-foreground w-4">{t(side === "left" ? "pill.sideL" : "pill.sideR")}</span>
        <span>{signed(r.camberDeg, 2)}°</span>
        <span className="text-muted-foreground">{signed(r.camberMm, 1)}mm</span>
        <span>{signed(r.casterDeg, 2)}°</span>
        <span className="text-muted-foreground">Δ{signed(r.trackDeltaMm, 1)}mm</span>
      </div>
    );
  };

  const toeCaption =
    toe.leftToeMm + toe.rightToeMm < -0.05
      ? t("pill.toe.out")
      : toe.leftToeMm + toe.rightToeMm > 0.05
        ? t("pill.toe.in")
        : t("pill.toe.neutral");

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={linked} onCheckedChange={(v) => setState((s) => ({
              ...s,
              linked: v,
              corners: v ? { left: s.corners.left, right: s.corners.left } : s.corners,
            }))} />
            {t("pill.linkSides")}
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={snapHoles} onCheckedChange={(v) => setState((s) => ({ ...s, snapHoles: v }))} />
            {t("pill.snapHoles")}
          </label>
          {sessionSetup && (
            <Button variant="outline" size="sm" className="h-7" onClick={() => void loadFromSetup()}>
              {t("pill.loadFromSetup")}
            </Button>
          )}
          <span className="ml-auto text-[10px] uppercase tracking-wide text-warning">{t("pillAlignment.badge")}</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 min-w-0">
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                {!linked && (
                  <div className="flex rounded border border-border overflow-hidden text-xs">
                    {(["left", "right"] as const).map((side) => (
                      <button
                        key={side}
                        onClick={() => setState((s) => ({ ...s, activeSide: side }))}
                        className={`px-2.5 py-1 ${activeSide === side ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                      >
                        {t(side === "left" ? "pill.sideLeft" : "pill.sideRight")}
                      </button>
                    ))}
                  </div>
                )}
                <Select
                  value={colorMode}
                  onValueChange={(v) => setState((s) => ({ ...s, colorMode: v as EnvelopeColorMode }))}
                >
                  <SelectTrigger className="h-7 w-40 text-xs ml-auto">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COLOR_MODE_KEYS) as EnvelopeColorMode[]).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(COLOR_MODE_KEYS[mode])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <EnvelopePlot
                points={envelope}
                loci={loci}
                colorMode={colorMode}
                cal={cal}
                toe={toe}
                side={activeSide}
                current={{ camberDeg: results[activeSide].camberDeg, casterDeg: results[activeSide].casterDeg }}
                onTarget={onEnvelopeTarget}
                darkMode={darkMode}
                xLabel={t("pill.envelope.xLabel")}
                yLabel={t("pill.envelope.yLabel")}
                legendLabel={t(COLOR_MODE_KEYS[colorMode])}
              />
              <p className="text-[10px] text-muted-foreground">{t("pill.envelope.dragHint")}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {dialCell("left", "top")}
              {dialCell("right", "top")}
              {dialCell("left", "bot")}
              {dialCell("right", "bot")}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className="w-4" />
                <span>{t("pill.readout.camber")}</span>
                <span>mm</span>
                <span>{t("pill.readout.caster")}</span>
                <span>{t("pill.readout.track")}</span>
              </div>
              {readoutRow("left")}
              {readoutRow("right")}
              <p className="text-[11px] text-muted-foreground pt-1 tabular-nums">
                {t("pill.readout.totalTrack", { value: signed(results.left.trackDeltaMm + results.right.trackDeltaMm, 2) })}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">{t("pill.toe.title")}</p>
                <button
                  onClick={() =>
                    setState((s) => ({ ...s, toe: { ...s.toe, mode: s.toe.mode === "rod" ? "perSide" : "rod" } }))
                  }
                  className="text-[10px] text-primary underline-offset-2 hover:underline"
                >
                  {toe.mode === "rod" ? t("pill.toe.usePerSide") : t("pill.toe.useRod")}
                </button>
              </div>
              {toe.mode === "rod" ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumRow label={t("pill.toe.rodDelta")} unit="mm" step={0.5} value={toe.rodDeltaMm} onChange={(v) => setState((s) => ({ ...s, toe: { ...s.toe, rodDeltaMm: v } }))} />
                  <NumRow label={t("pill.toe.rArm")} unit="mm" step={1} value={toe.rArmMm} onChange={(v) => setState((s) => ({ ...s, toe: { ...s.toe, rArmMm: Math.max(v, 1) } }))} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <NumRow label={t("pill.toe.left")} unit="mm" step={0.5} value={toe.leftToeMm} onChange={(v) => setState((s) => ({ ...s, toe: { ...s.toe, leftToeMm: v } }))} />
                  <NumRow label={t("pill.toe.right")} unit="mm" step={0.5} value={toe.rightToeMm} onChange={(v) => setState((s) => ({ ...s, toe: { ...s.toe, rightToeMm: v } }))} />
                </div>
              )}
              <OverheadToeView leftToeMm={toe.leftToeMm} rightToeMm={toe.rightToeMm} lRimMm={cal.lRimMm} caption={toeCaption} />
            </div>
          </div>
        </div>

        <Section title={t("pill.findSetup.title")} defaultOpen>
          <FindSetupPanel
            key={setupSeed ? `${setupSeed.camber}/${setupSeed.castor}` : "no-seed"}
            cal={cal}
            side={activeSide}
            snapHoles={snapHoles}
            currentCasterDeg={results[activeSide].casterDeg}
            seedCamberDeg={setupSeed?.camber}
            seedCasterDeg={setupSeed?.castor}
            onApply={(pills) => setCorner(activeSide, pills)}
          />
        </Section>

        <Section title={t("pill.cal.title")}>
          <CalibrationPanel
            cal={cal}
            profileId={state.profileId}
            userProfiles={userProfiles}
            onChange={(calibration, profileId) => setState((s) => ({ ...s, calibration, profileId }))}
            onSaveProfile={(name) => {
              const profile = makeUserProfile(name, cal, userProfiles);
              setUserProfiles((list) => upsertUserProfile(list, profile));
              setState((s) => ({ ...s, profileId: profile.id }));
            }}
            onDeleteProfile={(id) => {
              setUserProfiles((list) => removeUserProfile(list, id));
              setState((s) => (s.profileId === id ? { ...s, profileId: null } : s));
            }}
          />
        </Section>
      </div>
    </div>
  );
}
