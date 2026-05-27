import { useCallback, useEffect, useMemo, useState } from "react";
import type { GpsSample, Lap, ParsedData, TrackCourseSelection } from "@/types/racing";
import type { Vehicle } from "@/lib/vehicleStorage";
import type { VehicleSetup } from "@/lib/setupStorage";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { formatLapTime } from "@/lib/lapCalculation";
import {
  buildSnapshot, fastestLap, makeCourseKey, makeSnapshotId, normalizeEngine,
  snapshotLapSamples, snapshotPromptKind,
  type LapSnapshot, type SnapshotPromptKind,
} from "@/lib/lapSnapshot";
import {
  deleteSnapshot, listSnapshots, saveSnapshot,
} from "@/lib/lapSnapshotStorage";

export interface UseLapSnapshotsParams {
  data: ParsedData | null;
  laps: Lap[];
  selection: TrackCourseSelection | null;
  selectedLapNumber: number | null;
  currentFileName: string | null;
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  /** Load a lap's samples as the (non-playable) comparison overlay. */
  onLoadOverlay: (samples: GpsSample[], label: string) => void;
  onClearOverlay: () => void;
}

export interface SnapshotPromptState {
  kind: SnapshotPromptKind;
  candidate: LapSnapshot;
  existing: LapSnapshot | null;
}

/** Human label for a loaded snapshot overlay — engine is shown so 2t vs 4t reads clearly. */
export function snapshotLabel(snap: LapSnapshot): string {
  return `${snap.engine || "Snapshot"} · ${formatLapTime(snap.lapTimeMs)}`;
}

export interface SaveSnapshotResult {
  saved: boolean;
  replaced: boolean;
  reason?: "no-engine" | "no-course" | "no-lap";
}

/**
 * Orchestrates lap snapshots for the active session: the per-course list, the
 * save-as-snapshot action, the "new course fastest lap" prompt on engine
 * assignment, and loading a snapshot as a comparison overlay.
 */
export function useLapSnapshots(params: UseLapSnapshotsParams) {
  const {
    data, laps, selection, selectedLapNumber, currentFileName,
    vehicles, setups, sessionKartId, sessionSetupId, onLoadOverlay, onClearOverlay,
  } = params;

  const [snapshots, setSnapshots] = useState<LapSnapshot[]>([]);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<SnapshotPromptState | null>(null);

  const refresh = useCallback(async () => {
    setSnapshots(await listSnapshots());
  }, []);

  // Load on mount + whenever the snapshot store changes (local saves, cloud pulls).
  useEffect(() => {
    void refresh();
    return onGarageChange((change) => {
      if (change.store === STORE_NAMES.LAP_SNAPSHOTS) void refresh();
    });
  }, [refresh]);

  const courseKey = useMemo(
    () => (selection ? makeCourseKey(selection.trackName, selection.courseName) : null),
    [selection],
  );

  const snapshotsForCourse = useMemo(
    () => (courseKey ? snapshots.filter((s) => s.courseKey === courseKey).sort((a, b) => a.lapTimeMs - b.lapTimeMs) : []),
    [snapshots, courseKey],
  );

  // The engine/vehicle/setup a snapshot would be saved under, for given assignment.
  const resolveContext = useCallback(
    (kartId: string | null, setupId: string | null) => {
      const vehicle = kartId ? vehicles.find((v) => v.id === kartId) ?? null : null;
      const setup = setupId ? setups.find((s) => s.id === setupId) ?? null : null;
      const engine = (vehicle?.engine ?? "").trim();
      return { vehicle, setup, engine };
    },
    [vehicles, setups],
  );

  /** Build the snapshot for a lap under a given engine/setup assignment, or null. */
  const buildCandidate = useCallback(
    (lap: Lap | null, kartId: string | null, setupId: string | null): LapSnapshot | null => {
      if (!lap || !data || !selection?.course) return null;
      const { vehicle, setup, engine } = resolveContext(kartId, setupId);
      if (!engine) return null;

      const id = makeSnapshotId(
        makeCourseKey(selection.trackName, selection.courseName),
        normalizeEngine(engine),
      );
      const existing = snapshots.find((s) => s.id === id) ?? null;

      return buildSnapshot({
        lap,
        samples: data.samples,
        course: selection.course,
        trackName: selection.trackName,
        courseName: selection.courseName,
        engine,
        sourceFileName: currentFileName ?? "session",
        recordedAt: data.startDate?.getTime(),
        vehicle: vehicle ? { id: vehicle.id, name: vehicle.name, number: vehicle.number } : undefined,
        setup: setup ?? undefined,
        createdAt: existing?.createdAt,
      });
    },
    [data, selection, snapshots, currentFileName, resolveContext],
  );

  /** True when the session has everything needed to capture a snapshot. */
  const canSnapshot = useMemo(
    () => Boolean(selection?.course && laps.length > 0 && resolveContext(sessionKartId, sessionSetupId).engine),
    [selection, laps.length, resolveContext, sessionKartId, sessionSetupId],
  );

  // ── Overlay loading (shares the external-reference slot; never auto-plays) ───
  const loadSnapshot = useCallback(
    (snap: LapSnapshot) => {
      onLoadOverlay(snapshotLapSamples(snap), snapshotLabel(snap));
      setActiveSnapshotId(snap.id);
    },
    [onLoadOverlay],
  );

  const clearActive = useCallback(() => {
    onClearOverlay();
    setActiveSnapshotId(null);
  }, [onClearOverlay]);

  // ── Save (manual) ────────────────────────────────────────────────────────
  const saveSelectedLap = useCallback(async (): Promise<SaveSnapshotResult> => {
    if (!selection?.course) return { saved: false, replaced: false, reason: "no-course" };
    const lap =
      (selectedLapNumber !== null ? laps.find((l) => l.lapNumber === selectedLapNumber) : null) ??
      fastestLap(laps);
    if (!lap) return { saved: false, replaced: false, reason: "no-lap" };
    const candidate = buildCandidate(lap, sessionKartId, sessionSetupId);
    if (!candidate) return { saved: false, replaced: false, reason: "no-engine" };
    const replaced = snapshots.some((s) => s.id === candidate.id);
    await saveSnapshot(candidate);
    return { saved: true, replaced };
  }, [selection, selectedLapNumber, laps, buildCandidate, sessionKartId, sessionSetupId, snapshots]);

  const removeSnapshot = useCallback(
    async (id: string) => {
      await deleteSnapshot(id);
      if (activeSnapshotId === id) clearActive();
    },
    [activeSnapshotId, clearActive],
  );

  // ── Auto-prompt on engine/setup assignment ──────────────────────────────────
  const maybePromptOnAssignment = useCallback(
    (kartId: string | null, setupId: string | null) => {
      const best = fastestLap(laps);
      const candidate = buildCandidate(best, kartId, setupId);
      if (!candidate) return;
      const existing = snapshots.find((s) => s.id === candidate.id) ?? null;
      const kind = snapshotPromptKind(candidate.lapTimeMs, existing);
      if (!kind) return;
      setPrompt({ kind, candidate, existing });
    },
    [laps, buildCandidate, snapshots],
  );

  const confirmPrompt = useCallback(async () => {
    if (!prompt) return;
    await saveSnapshot(prompt.candidate);
    setPrompt(null);
  }, [prompt]);

  const dismissPrompt = useCallback(() => setPrompt(null), []);

  return {
    snapshots,
    snapshotsForCourse,
    activeSnapshotId,
    canSnapshot,
    loadSnapshot,
    clearActive,
    setActiveSnapshotId,
    saveSelectedLap,
    removeSnapshot,
    refresh,
    prompt,
    maybePromptOnAssignment,
    confirmPrompt,
    dismissPrompt,
  };
}
