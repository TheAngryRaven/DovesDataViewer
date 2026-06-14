/**
 * Datalogger tool — live GPS lap timing using the phone as the logger.
 *
 * PHASE 1 UI: a laptimer-style readout (no map — this is a heads-up timer, not a
 * map view), with the delta to your best lap as the dominant field. A "Lap Times"
 * view lists completed laps with their major-sector splits (fine-grained sectors
 * live in the full session viewer). The capture + timing engine is the real
 * foundation (`@/lib/gps`, `useDatalogger`); visuals get tuned in a later phase.
 *
 * Behavior: starts capturing the moment it opens, begins recording above 5 mph,
 * auto-ends after 5 min stopped, and saves a `.dovep` log to IndexedDB on end
 * (openable + processable like any uploaded session). A red control ends the
 * session manually after a confirm; ended sessions can be restarted.
 */
import { useState } from "react";
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
import { useDatalogger } from "./useDatalogger";
import type { TimingState } from "@/lib/gps";

type View = "live" | "laps";

function fmtLap(ms: number | null | undefined): string {
  return ms != null ? formatLapTime(ms) : "—:—.———";
}

export default function DataloggerTool(props: PluginPanelProps) {
  const logger = useDatalogger();
  const { phase, timing, laps, latest, saving, savedFileName, error, endSession, reset } = logger;
  const [view, setView] = useState<View>("live");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const useKph = props.useKph;
  const speedMps = latest?.fix.speed ?? latest?.motion.speedMps ?? 0;
  const speed = useKph ? speedMps * 3.6 : speedMps * 2.236936;
  const speedUnit = useKph ? "km/h" : "mph";

  return (
    <div className="relative flex h-full w-full flex-col bg-background">
      {/* Header: view toggle + status + end */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 shrink-0">
        <div className="flex gap-1">
          <Tab active={view === "live"} onClick={() => setView("live")}>Datalogger</Tab>
          <Tab active={view === "laps"} onClick={() => setView("laps")}>Lap Times</Tab>
        </div>
        <div className="flex items-center gap-3">
          <Status phase={phase} courseName={timing.courseName} trackName={timing.trackName} />
          {phase !== "ended" && (
            <Button variant="destructive" size="sm" className="h-8 gap-1" onClick={() => setConfirmOpen(true)}>
              <Square className="h-3.5 w-3.5" /> End
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {view === "live" ? (
          <LiveView timing={timing} speed={speed} speedUnit={speedUnit} />
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
                <p className="text-sm text-muted-foreground">Saving session…</p>
              </>
            ) : savedFileName ? (
              <>
                <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
                <p className="text-sm font-medium text-foreground">Session saved</p>
                <p className="break-all text-xs text-muted-foreground">{savedFileName}</p>
                <p className="text-xs text-muted-foreground">Find it in your saved files to review like any log.</p>
                <Button size="sm" onClick={reset}>New session</Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">No lap data recorded</p>
                <p className="text-xs text-muted-foreground">You need to be moving (above 5&nbsp;mph) for a session to record.</p>
                <Button size="sm" onClick={reset}>Start new session</Button>
              </>
            )}
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End session?</DialogTitle>
            <DialogDescription>
              This stops logging and saves the session to your files. You can't add more to it afterward.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setConfirmOpen(false); void endSession(); }}>
              End session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The laptimer heads-up: delta dominant, then current/best/last/optimal + speed. */
function LiveView({ timing, speed, speedUnit }: { timing: TimingState; speed: number; speedUnit: string }) {
  const delta = timing.deltaSec;
  const deltaColor = delta == null ? "text-muted-foreground" : delta > 0 ? "text-red-500" : "text-green-500";
  const deltaText = delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}`;

  return (
    <div className="flex h-full flex-col">
      {/* Delta — the dominant field */}
      <div className="flex flex-col items-center justify-center py-6">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Delta to best</div>
        <div className={`font-mono text-7xl font-bold leading-none tabular-nums sm:text-8xl ${deltaColor}`}>
          {deltaText}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">seconds {delta != null && (delta > 0 ? "slower" : "faster")}</div>
      </div>

      {/* Current lap, large */}
      <div className="flex flex-col items-center pb-4">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Current lap</div>
        <div className="font-mono text-4xl font-semibold tabular-nums text-foreground">{fmtLap(timing.currentLapMs)}</div>
      </div>

      {/* Supporting fields */}
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border/60 sm:grid-cols-4">
        <Cell label="Best" value={fmtLap(timing.bestLapMs)} />
        <Cell label="Last" value={fmtLap(timing.lastLapMs)} />
        <Cell label="Optimal" value={fmtLap(timing.optimalMs)} />
        <Cell label="Speed" value={speed.toFixed(0)} unit={speedUnit} />
      </div>

      {timing.majorSectors.length > 0 && (
        <div className="grid grid-cols-3 gap-px border-t border-border bg-border/60">
          {timing.majorSectors.map((s, i) => (
            <Cell key={i} label={`S${i + 1} best`} value={s.best != null ? formatSectorTime(s.best) : "—"} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Completed laps with major-sector splits (fine-grained sectors live in the viewer). */
function LapTimesView({ laps, bestLapNumber }: { laps: Lap[]; bestLapNumber: number | null }) {
  if (laps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">No laps yet — complete a lap to see times here.</p>
      </div>
    );
  }
  const hasSectors = laps.some((l) => l.sectors);
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border">
          <th className="px-3 py-2 text-left font-medium">Lap</th>
          <th className="px-3 py-2 text-right font-medium">Time</th>
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
                {best && <span className="ml-1 text-[10px] text-primary">BEST</span>}
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
  if (phase === "recording") {
    return (
      <span className="text-xs text-red-500">
        <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" />
        {trackName ?? "Recording"}{courseName ? ` · ${courseName}` : ""}
      </span>
    );
  }
  if (phase === "ended") return <span className="text-xs text-muted-foreground">Ended</span>;
  return <span className="text-xs text-muted-foreground">Waiting — drive above 5 mph</span>;
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
