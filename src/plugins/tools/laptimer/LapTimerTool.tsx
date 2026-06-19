/**
 * Lap Timer tool — live GPS lap timing using the phone as the logger.
 *
 * PHASE 1 UI: a lap-timer readout (no map — this is a heads-up timer, not a
 * map view), with the delta to your best lap as the dominant field. A "Lap Times"
 * view lists completed laps with their major-sector splits (fine-grained sectors
 * live in the full session viewer). The capture + timing engine is the real
 * foundation (`@/lib/gps`, `useLapTimer`); visuals get tuned in a later phase.
 *
 * Behavior: starts capturing the moment it opens, begins recording above 5 mph,
 * auto-ends after 5 min stopped, and saves a `.dovep` log to IndexedDB on end
 * (openable + processable like any uploaded session). A red control ends the
 * session manually after a confirm; ended sessions can be restarted.
 */
import { useState, memo } from "react";
import { Loader2, CheckCircle2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { PluginPanelProps } from "@/plugins/panels";
import type { Lap } from "@/types/racing";
import { formatLapTime, formatSectorTime } from "@/lib/lapCalculation";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useLapTimer } from "./useLapTimer";
import { useToolsT, type ToolsKey } from "../i18n";
import type { TimingState, GpsObservation, SessionPhase } from "@/lib/gps";

type ToolsT = (key: ToolsKey, opts?: Record<string, unknown>) => string;
type View = "live" | "laps";

function fmtLap(ms: number | null | undefined): string {
  return ms != null ? formatLapTime(ms) : "—:—.———";
}

export default function LapTimerTool(props: PluginPanelProps) {
  const t = useToolsT();
  const logger = useLapTimer();
  const { phase, timing, laps, latest, saving, savedFileName, error, endSession, reset } = logger;
  const [view, setView] = useState<View>("live");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Keep the screen awake while a session is live — a lap timer is useless if the
  // phone sleeps mid-session. Released once the session has ended.
  useWakeLock(phase !== "ended");

  const useKph = props.useKph;
  const speedMps = latest?.fix.speed ?? latest?.motion.speedMps ?? 0;
  const speed = useKph ? speedMps * 3.6 : speedMps * 2.236936;
  const speedUnit = useKph ? "km/h" : "mph";

  // Speedometer-only mode: before logging arms, or recording far from any known
  // track. No timing context, so there's no lap list to show.
  const speedoOnly = phase === "waiting" || timing.nearKnownTrack === false;
  const effectiveView: View = speedoOnly ? "live" : view;

  return (
    <div className="relative flex h-full w-full flex-col bg-background">
      {/* Header: view toggle + status + end */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 shrink-0">
        <div className="flex gap-1">
          {!speedoOnly && (
            <>
              <Tab active={effectiveView === "live"} onClick={() => setView("live")}>{t("laptimer.tabLive")}</Tab>
              <Tab active={effectiveView === "laps"} onClick={() => setView("laps")}>{t("laptimer.tabLaps")}</Tab>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Status phase={phase} courseName={timing.courseName} trackName={timing.trackName} />
          {phase !== "ended" && (
            <Button variant="destructive" size="sm" className="h-8 gap-1" onClick={() => setConfirmOpen(true)}>
              <Square className="h-3.5 w-3.5 fill-current" /> {t("laptimer.end")}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {effectiveView === "live" ? (
          <LiveView timing={timing} speed={speed} speedUnit={speedUnit} phase={phase} latest={latest} />
        ) : (
          <LapTimesView laps={laps} bestLapNumber={timing.bestLapNumber} />
        )}
      </div>

      {/* Ended overlay */}
      {phase === "ended" && (
        <div className="absolute inset-0 z-[10] flex items-center justify-center bg-background/90 backdrop-blur">
          <div className="max-w-sm space-y-3 px-6 text-center">
            {saving ? (
              <>
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("laptimer.saving")}</p>
              </>
            ) : savedFileName ? (
              <>
                <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
                <p className="text-sm font-medium text-foreground">{t("laptimer.savedTitle")}</p>
                <p className="break-all text-xs text-muted-foreground">{savedFileName}</p>
                <p className="text-xs text-muted-foreground">{t("laptimer.savedHint")}</p>
                <Button size="sm" onClick={reset}>{t("laptimer.newSession")}</Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">{t("laptimer.noDataTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("laptimer.noDataBody")}</p>
                <Button size="sm" onClick={reset}>{t("laptimer.startNewSession")}</Button>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("laptimer.endDialogTitle")}</DialogTitle>
            <DialogDescription>{t("laptimer.endDialogBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t("laptimer.cancel")}</Button>
            <Button variant="destructive" onClick={() => { setConfirmOpen(false); void endSession(); }}>
              {t("laptimer.endSession")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The laptimer heads-up: delta dominant, then current/best/last/optimal + speed. */
function LiveView({
  timing,
  speed,
  speedUnit,
  phase,
  latest,
}: {
  timing: TimingState;
  speed: number;
  speedUnit: string;
  phase: SessionPhase;
  latest: GpsObservation | null;
}) {
  const t = useToolsT();
  const farFromTrack = timing.nearKnownTrack === false;
  const waiting = phase === "waiting";
  // Speedometer mode: before logging arms (confirm GPS/speed while stationary),
  // or recording far from any known track (no timing context). The title explains
  // *why* we're showing a bare speedometer: "no tracks nearby" when we're far, or
  // — when we recognise the track but logging hasn't armed yet — a confirmation
  // that the track was detected (so sitting still at a known track doesn't look
  // identical to being nowhere near one).
  if (waiting || farFromTrack) {
    let title: string | undefined;
    if (farFromTrack) title = t("laptimer.speedometerMode");
    else if (timing.nearbyTrackName) title = t("laptimer.trackDetected", { track: timing.nearbyTrackName });
    return (
      <SpeedometerView
        speed={speed}
        speedUnit={speedUnit}
        latest={latest}
        title={title}
        hint={waiting ? t("laptimer.waitingHint") : t("laptimer.farHint")}
      />
    );
  }

  const delta = timing.deltaSec;
  const deltaColor = delta == null ? "text-muted-foreground" : delta > 0 ? "text-destructive" : "text-success";
  const deltaText = delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;

  return (
    <div className="flex h-full flex-col">
      {/* Delta — the dominant field */}
      <div className="flex flex-col items-center justify-center py-6">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{t("laptimer.deltaLabel")}</div>
        <div className={`font-mono text-7xl font-bold leading-none tabular-nums sm:text-8xl ${deltaColor}`}>
          {deltaText}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {delta != null && t(delta > 0 ? "laptimer.secondsSlower" : "laptimer.secondsFaster")}
        </div>
      </div>

      {/* Current lap, large */}
      <div className="flex flex-col items-center pb-4">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{t("laptimer.currentLap")}</div>
        <div className="font-mono text-4xl font-semibold tabular-nums text-foreground">{fmtLap(timing.currentLapMs)}</div>
      </div>

      {/* Supporting fields */}
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border/60 sm:grid-cols-4">
        <Cell label={t("laptimer.best")} value={fmtLap(timing.bestLapMs)} />
        <Cell label={t("laptimer.last")} value={fmtLap(timing.lastLapMs)} />
        <Cell label={t("laptimer.optimal")} value={fmtLap(timing.optimalMs)} />
        <Cell label={t("laptimer.speed")} value={speed.toFixed(0)} unit={speedUnit} />
      </div>

      {timing.majorSectors.length > 0 && (
        <div className="grid grid-cols-3 gap-px border-t border-border bg-border/60">
          {timing.majorSectors.map((s, i) => (
            <Cell key={i} label={t("laptimer.sectorBest", { n: i + 1 })} value={s.best != null ? formatSectorTime(s.best) : "—"} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Completed laps with major-sector splits (fine-grained sectors live in the
 * viewer). Memoized: laps + bestLapNumber only change when a lap completes, so
 * the table doesn't re-render on every GPS fix while this view is open.
 */
const LapTimesView = memo(function LapTimesView({ laps, bestLapNumber }: { laps: Lap[]; bestLapNumber: number | null }) {
  const t = useToolsT();
  if (laps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("laptimer.noLaps")}</p>
      </div>
    );
  }
  const hasSectors = laps.some((l) => l.sectors);
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border">
          <th className="px-3 py-2 text-left font-medium">{t("laptimer.colLap")}</th>
          <th className="px-3 py-2 text-right font-medium">{t("laptimer.colTime")}</th>
          {hasSectors && <th className="px-2 py-2 text-right font-medium">S1</th>}
          {hasSectors && <th className="px-2 py-2 text-right font-medium">S2</th>}
          {hasSectors && <th className="px-2 py-2 text-right font-medium">S3</th>}
        </tr>
      </thead>
      <tbody className="font-mono tabular-nums">
        {laps.map((lap) => {
          const best = lap.lapNumber === bestLapNumber;
          return (
            <tr key={lap.lapNumber} className={`border-b border-border/40 ${best ? "bg-primary/10" : ""}`}>
              <td className="px-3 py-1.5 font-sans">
                {lap.lapNumber}
                {best && <span className="ml-1 text-[10px] text-primary">{t("laptimer.bestTag")}</span>}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold">{fmtLap(lap.lapTimeMs)}</td>
              {hasSectors && <td className="px-2 py-1.5 text-right text-muted-foreground">{lap.sectors?.s1 != null ? formatSectorTime(lap.sectors.s1) : "—"}</td>}
              {hasSectors && <td className="px-2 py-1.5 text-right text-muted-foreground">{lap.sectors?.s2 != null ? formatSectorTime(lap.sectors.s2) : "—"}</td>}
              {hasSectors && <td className="px-2 py-1.5 text-right text-muted-foreground">{lap.sectors?.s3 != null ? formatSectorTime(lap.sectors.s3) : "—"}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

/** Plain digital speedometer + an optional title, a hint, and a live GPS readout. */
function SpeedometerView({
  speed,
  speedUnit,
  latest,
  hint,
  title,
}: {
  speed: number;
  speedUnit: string;
  latest: GpsObservation | null;
  hint: string;
  title?: string;
}) {
  const t = useToolsT();
  if (!latest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("laptimer.acquiringGps")}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      {/* Speed — centered and dominant */}
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{t("laptimer.speed")}</div>
        <div className="font-mono text-8xl font-bold leading-none tabular-nums text-foreground">
          {speed.toFixed(0)}
          <span className="ml-2 text-2xl font-normal text-muted-foreground">{speedUnit}</span>
        </div>
      </div>
      {/* Message — pinned to the bottom of the speedo screen */}
      <div className="shrink-0 border-t border-border p-4 text-center">
        {title && <p className="text-sm font-semibold text-foreground">{title}</p>}
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{hint}</p>
        <p className="mt-2 text-xs text-muted-foreground/70">
          {t("laptimer.gpsQuality", { accuracy: latest.fix.accuracy.toFixed(0), quality: latest.fix.quality })}
        </p>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Status({ phase, courseName, trackName }: { phase: string; courseName: string | null; trackName: string | null }) {
  const t = useToolsT();
  if (phase === "recording") {
    return (
      <span className="text-xs text-destructive">
        <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-destructive align-middle" />
        {trackName ?? t("laptimer.statusRecording")}{courseName ? ` · ${courseName}` : ""}
      </span>
    );
  }
  if (phase === "ended") return <span className="text-xs text-muted-foreground">{t("laptimer.statusEnded")}</span>;
  return <span className="text-xs text-muted-foreground">{t("laptimer.statusWaiting")}</span>;
}

function Cell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="bg-background px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums text-foreground">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
