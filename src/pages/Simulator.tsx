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

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, Pause, Play, SkipForward, Upload } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { BackToHome } from "@/components/BackToHome";
import { useSettings } from "@/hooks/useSettings";
import { SimDevicePanel } from "@/components/sim/SimDevicePanel";
import { SimGuide } from "@/components/sim/SimGuide";
import { SimMap } from "@/components/sim/SimMap";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSimPlayback } from "@/hooks/useSimPlayback";
import { ensureSampleFile, SAMPLE_DISPLAY_NAME, SAMPLE_FILE_NAME } from "@/lib/sampleData";
import { parseDatalogFile } from "@/lib/datalogParser";
import { formatLapTime } from "@/lib/lapCalculation";
import { autoDetectCourse } from "@/lib/courseDetection";
import { loadTracks } from "@/lib/trackStorage";
import { positionIndexAt } from "@/lib/sim/simPlayback";
import { parseSimSession, SIM_SESSION_ACCEPT } from "@/lib/sim/simSession";
import type { Course, ParsedData } from "@/types/racing";

const TRUE_SIZE_SEEN_KEY = "dove-sim-true-size-seen";

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

/** Load + parse the bundled demo session (IDB-cached after first fetch). */
async function loadDemoSession(): Promise<ParsedData> {
  const blob = await ensureSampleFile();
  if (!blob) throw new Error("sample unavailable");
  return parseDatalogFile(new File([blob], SAMPLE_FILE_NAME));
}

const Simulator = () => {
  const { t } = useTranslation("simulator");
  const navigate = useNavigate();
  const { settings, setSettings, toggleFieldDefault } = useSettings();
  const [data, setData] = useState<ParsedData | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [sessionName, setSessionName] = useState<string>("");
  const [loadError, setLoadError] = useState(false);
  /** Name of a user-picked file that failed to parse (null = no error). */
  const [pickError, setPickError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // True-size default ON for first-time visitors (the spec's honesty rule);
  // remembered once toggled so returning users keep their preference.
  const [trueSize, setTrueSize] = useState(
    () => localStorage.getItem(TRUE_SIZE_SEEN_KEY) === null ||
          localStorage.getItem(TRUE_SIZE_SEEN_KEY) === "true",
  );
  const [scale, setScale] = useState(4);

  const sim = useSimPlayback(data);

  // Adopt a parsed session: detect the course (same offline track DB the
  // whole app uses) so the map can draw the start/finish line.
  const adoptSession = async (parsed: ParsedData, name: string) => {
    let detected: Course | null = null;
    try {
      const tracks = await loadTracks();
      const det = autoDetectCourse(parsed.samples, tracks);
      if (det && !det.isWaypointMode) detected = det.course;
    } catch (e) {
      console.warn("simulator: course detection failed", e);
    }
    setCourse(detected);
    setSessionName(name);
    setData(parsed);
  };

  // Start on the bundled demo session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await loadDemoSession();
        if (!cancelled) await adoptSession(parsed, SAMPLE_DISPLAY_NAME);
      } catch (e) {
        console.error("simulator: demo session load failed", e);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // User-picked dove-family log (the bug-hunting path): parsed leniently, so
  // a file with a missing or corrupted metadata preamble still replays as
  // long as its CSV column headers survived. A failed parse keeps the
  // current session and reports the file name inline.
  const onSessionFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = parseSimSession(await file.text());
      setPickError(null);
      await adoptSession(parsed, file.name);
    } catch (err) {
      console.error("simulator: session file load failed", err);
      setPickError(file.name);
    }
  };

  const onReloadDemo = async () => {
    try {
      const parsed = await loadDemoSession();
      setPickError(null);
      await adoptSession(parsed, SAMPLE_DISPLAY_NAME);
    } catch (e) {
      console.error("simulator: demo session load failed", e);
      setLoadError(true);
    }
  };

  const onTrueSizeChange = (v: boolean) => {
    setTrueSize(v);
    localStorage.setItem(TRUE_SIZE_SEEN_KEY, String(v));
  };

  const st = sim.simState;
  const positionLabel = useMemo(() => {
    if (sim.positionMs < 0) return t("transport.preRoll");
    return `${fmtClock(sim.positionMs)} / ${fmtClock(sim.durationMs)}`;
  }, [sim.positionMs, sim.durationMs, t]);

  // Map cursor from the SAME playback cursor the sim runs on — the marker,
  // the sim display and the scrubber share one clock and cannot disagree.
  const epochMs = data?.startDate ? data.startDate.getTime() : 0;
  const positionIndex = useMemo(() => {
    if (!data || sim.positionMs < 0) return -1;
    return positionIndexAt(data.samples, epochMs, epochMs + sim.positionMs);
  }, [data, epochMs, sim.positionMs]);

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

        {!loading && sim.status === "ready" && data && (
          <div className="flex flex-col gap-6">
            <SimGuide />

            {/* Session picker: the bundled demo, or any user .dovex/.dove log */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("picker.label")}</span>
                <span className="max-w-64 truncate font-medium">{sessionName}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1 h-4 w-4" />
                  {t("picker.load")}
                </Button>
                {sessionName !== SAMPLE_DISPLAY_NAME && (
                  <Button size="sm" variant="ghost" onClick={onReloadDemo}>
                    {t("picker.demo")}
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SIM_SESSION_ACCEPT}
                  className="hidden"
                  onChange={onSessionFile}
                />
              </div>
              {pickError && (
                <p className="text-center text-xs text-destructive">
                  {t("picker.error", { name: pickError })}
                </p>
              )}
            </div>

            <SimMap
              samples={data.samples}
              course={course}
              positionIndex={positionIndex}
            />

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

            {/* What the firmware is actually doing (plan 0010 follow-up) */}
            <div className="rounded-lg border border-border bg-card/50 p-4 text-sm">
              <p className="mb-2 font-semibold">{t("howItWorks.title")}</p>
              <div className="space-y-2 text-muted-foreground">
                <p>{t("howItWorks.p1")}</p>
                <p>{t("howItWorks.p2")}</p>
                <p>{t("howItWorks.p3")}</p>
              </div>
            </div>

            {/* Live firmware state */}
            {st && (
              <div
                className="flex flex-wrap items-center justify-center gap-2 text-xs"
                data-sim-page={st.page}
              >
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
