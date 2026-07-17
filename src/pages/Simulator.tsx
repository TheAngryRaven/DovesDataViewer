/**
 * /simulator — "da simulator" (plan 0010, Phase A).
 *
 * The REAL DovesDataLogger firmware (vendored wasm, `public/sim/`) booted
 * in the browser and driven by the bundled OKC sample session — the same
 * file the firmware repo's CI oracle proves reproduces the hardware's 13
 * lap times to the exact millisecond. Press Play: the device boots,
 * acquires GPS (real firmware UX), auto-enters race mode when the engine
 * "starts", detects the track, and counts laps. The three buttons drive
 * the real menus at any time, including mid-playback.
 *
 * Phase B (plan 0010) adds the map + cursor above this panel; Phase C
 * adds capture/share.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Pause, Play, SkipForward } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { BackToHome } from "@/components/BackToHome";
import { useSettings } from "@/hooks/useSettings";
import { SimDevicePanel } from "@/components/sim/SimDevicePanel";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSimPlayback } from "@/hooks/useSimPlayback";
import { ensureSampleFile, SAMPLE_FILE_NAME } from "@/lib/sampleData";
import { parseDatalogFile } from "@/lib/datalogParser";
import { formatLapTime } from "@/lib/lapCalculation";
import type { ParsedData } from "@/types/racing";

const TRUE_SIZE_SEEN_KEY = "dove-sim-true-size-seen";

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

const Simulator = () => {
  const { t } = useTranslation("simulator");
  const navigate = useNavigate();
  const { settings, setSettings, toggleFieldDefault } = useSettings();
  const [data, setData] = useState<ParsedData | null>(null);
  const [loadError, setLoadError] = useState(false);
  // True-size default ON for first-time visitors (the spec's honesty rule);
  // remembered once toggled so returning users keep their preference.
  const [trueSize, setTrueSize] = useState(
    () => localStorage.getItem(TRUE_SIZE_SEEN_KEY) === null ||
          localStorage.getItem(TRUE_SIZE_SEEN_KEY) === "true",
  );
  const [scale, setScale] = useState(4);

  const sim = useSimPlayback(data);

  // Load + parse the bundled demo session (IDB-cached after first fetch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await ensureSampleFile();
        if (!blob) throw new Error("sample unavailable");
        const file = new File([blob], SAMPLE_FILE_NAME);
        const parsed = await parseDatalogFile(file);
        if (!cancelled) setData(parsed);
      } catch (e) {
        console.error("simulator: demo session load failed", e);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onTrueSizeChange = (v: boolean) => {
    setTrueSize(v);
    localStorage.setItem(TRUE_SIZE_SEEN_KEY, String(v));
  };

  const st = sim.simState;
  const positionLabel = useMemo(() => {
    if (sim.positionMs < 0) return t("transport.preRoll");
    return `${fmtClock(sim.positionMs)} / ${fmtClock(sim.durationMs)}`;
  }, [sim.positionMs, sim.durationMs, t]);

  const loading = !loadError && (data === null || sim.status === "loading");

  const settingsButton = (
    <SettingsModal
      settings={settings}
      onSettingsChange={setSettings}
      onToggleFieldDefault={toggleFieldDefault}
      canHideSampleFiles
      triggerLabelBreakpoint="sm"
    />
  );

  return (
    <div className="min-h-screen bg-background safe-area-x">
      <SiteHeader
        settingsButton={settingsButton}
        enableCloud={enableCloud}
        onOpenProfile={() => navigate("/", { state: { openProfile: true } })}
        showSupportedFiles={false}
        showAbout={false}
      />

      <main className="container mx-auto max-w-3xl px-4 py-6">
        <BackToHome className="mb-4" />

        <div className="mb-4 text-center">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        {loadError && (
          <p className="py-16 text-center text-sm text-destructive">{t("loadError")}</p>
        )}
        {loading && !loadError && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t("loading")}</span>
          </div>
        )}
        {sim.status === "error" && (
          <p className="py-16 text-center text-sm text-destructive">{t("loadError")}</p>
        )}

        {!loading && sim.status === "ready" && (
          <div className="flex flex-col gap-6">
            <SimDevicePanel
              setFrameSink={sim.setFrameSink}
              buttonDown={sim.buttonDown}
              buttonUp={sim.buttonUp}
              trueSize={trueSize}
              onTrueSizeChange={onTrueSizeChange}
              scale={scale}
              onScaleChange={setScale}
            />

            {/* Transport */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={sim.playing ? sim.pause : sim.play}
                  aria-label={sim.playing ? t("transport.pause") : t("transport.play")}
                >
                  {sim.playing
                    ? <Pause className="h-4 w-4" />
                    : <Play className="h-4 w-4" />}
                </Button>
                {sim.inPreRoll && (
                  <Button size="sm" variant="outline" onClick={sim.skipPreRoll}>
                    <SkipForward className="mr-1 h-4 w-4" />
                    {t("transport.skipPreRoll")}
                  </Button>
                )}
                <Select
                  value={String(sim.speed)}
                  onValueChange={(v) => sim.setSpeed(Number(v))}
                >
                  <SelectTrigger className="h-9 w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 5, 10].map((x) => (
                      <SelectItem key={x} value={String(x)}>{x}×</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="ml-auto font-mono text-sm text-muted-foreground">
                  {positionLabel}
                </span>
              </div>

              <div className="mt-4">
                <Slider
                  value={[Math.max(0, sim.positionMs)]}
                  min={0}
                  max={Math.max(1, sim.durationMs)}
                  step={1000}
                  onValueChange={(v) => sim.seek(v[0])}
                  aria-label={t("transport.timeline")}
                />
              </div>
            </div>

            {/* Live firmware state */}
            {st && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                <Badge variant={st.raceActive ? "default" : "secondary"}>
                  {st.raceActive ? t("state.racing") : t("state.idle")}
                </Badge>
                <Badge variant="secondary">
                  {t("state.laps", { count: st.lapCount })}
                </Badge>
                {st.bestLapMs > 0 && (
                  <Badge variant="secondary">
                    {t("state.best")} {formatLapTime(st.bestLapMs)}
                  </Badge>
                )}
                <Badge variant="secondary">{st.rpm} RPM</Badge>
                <Badge variant={st.gpsFix ? "default" : "outline"}>
                  {st.gpsFix ? t("state.gpsLocked", { sats: st.sats }) : t("state.gpsAcquiring")}
                </Badge>
                {st.trackDetected && st.courseName && (
                  <Badge variant="secondary">{st.courseName}</Badge>
                )}
              </div>
            )}

            {sim.version && (
              <p className="text-center text-[11px] text-muted-foreground">
                {t("footer.provenance", {
                  sha: sim.version.firmwareSha,
                  date: sim.version.buildDate,
                })}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Simulator;
