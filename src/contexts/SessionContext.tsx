import { createContext, useContext } from 'react';
import type {
  GpsSample, Course, FieldMapping, Lap, ParsedData, ParserStats,
} from '@/types/racing';
import type { WeatherStation } from '@/lib/weatherService';
import type { FileEntry } from '@/lib/fileStorage';
import type { VideoSyncState, VideoSyncActions } from '@/hooks/useVideoSync';
import type { Vehicle } from '@/lib/vehicleStorage';
import type { VehicleSetup } from '@/lib/setupStorage';
import type { SetupTemplate } from '@/lib/templateStorage';
import type { LapSnapshot } from '@/lib/lapSnapshot';
import type { OverlayLine } from '@/lib/lapOverlays';
import type { SaveSnapshotResult } from '@/hooks/useLapSnapshots';
import type { PluginSnapshot } from '@/plugins/panels';

/**
 * Session-scoped state and handlers shared by the three main view tabs
 * (RaceLineTab, LapTimesTab, GraphViewTab).
 *
 * Tabs read this via `useSessionContext()` instead of receiving 25+ props
 * from Index.tsx.
 *
 * The playback cursor (currentIndex / currentSample) deliberately does NOT
 * live here — it changes at playback rate and would re-render every consumer
 * per tick (context updates bypass memo()). Cursor-tracking components read
 * `usePlaybackContext()` (PlaybackContext.tsx) instead.
 */
export interface SessionContextValue {
  // ── Sample data ───────────────────────────────────────────────────────────
  data: ParsedData | null;
  visibleSamples: GpsSample[];
  filteredSamples: GpsSample[];
  allSamples: GpsSample[];
  referenceSamples: GpsSample[];
  fieldMappings: FieldMapping[];

  // ── Range ─────────────────────────────────────────────────────────────────
  visibleRange: [number, number];
  minRange: number;

  // ── Track / course ────────────────────────────────────────────────────────
  course: Course | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;

  // ── Laps ──────────────────────────────────────────────────────────────────
  laps: Lap[];
  selectedLapNumber: number | null;
  selectedLapTimeMs: number | null;
  referenceLapNumber: number | null;
  isAllLaps: boolean;

  // ── Reference comparison ──────────────────────────────────────────────────
  hasReference: boolean;
  paceDiff: number | null;
  paceDiffLabel: 'best' | 'ref';
  paceData: (number | null)[];
  referenceSpeedData: (number | null)[];
  deltaTopSpeed: number | null;
  deltaMinSpeed: number | null;
  lapToFastestDelta: number | null;
  refAvgTopSpeed: number | null;
  refAvgMinSpeed: number | null;

  // ── External reference ────────────────────────────────────────────────────
  externalRefLabel: string | null;
  savedFiles: FileEntry[];

  // ── Lap snapshots (loaded as the reference overlay) ───────────────────────
  snapshotsForCourse: LapSnapshot[];
  activeSnapshotId: string | null;
  /** The loaded reference snapshot as a curated, clean-lap view for plugin panels. */
  activeSnapshot: PluginSnapshot | null;
  /** The setup currently assigned to the session log, resolved for plugin panels. */
  sessionSetup: VehicleSetup | null;
  canSnapshot: boolean;
  onLoadSnapshot: (snap: LapSnapshot) => void;
  onClearSnapshot: () => void;
  onSaveSnapshot: (force?: boolean) => Promise<SaveSnapshotResult>;

  // ── Multi-lap overlays (extra racing lines on the maps + graphs) ──────────
  overlaySelections: string[];
  overlayLines: OverlayLine[];
  onToggleOverlay: (id: string) => void;
  /** Drift-align cross-session overlays onto the current lap (map only). */
  alignOverlays: boolean;
  onToggleAlignOverlays: () => void;
  /** Expand the overlay legend (per-lap list) on the maps. Lines stay drawn when collapsed. */
  showOverlayLegend: boolean;
  onToggleOverlayLegend: () => void;
  /** Load another saved file's laps for the overlay picker. */
  onLoadOverlayFile: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  /** Add a lap from a loaded external file as an overlay. */
  onAddExternalOverlay: (fileName: string, lapNumber: number) => void;

  // ── Session metadata ──────────────────────────────────────────────────────
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  sessionFileName: string | null;
  sessionKartId: string | null;
  sessionSetupId: string | null;
  cachedWeatherStation: WeatherStation | null;
  parserStats?: ParserStats | null;

  // ── Vehicle / setup catalog (for save-setup UI in the Pro tab) ────────────
  vehicles: Vehicle[];
  setups: VehicleSetup[];
  templates: SetupTemplate[];

  // ── Video sync (Pro tab) ──────────────────────────────────────────────────
  videoState: VideoSyncState;
  videoActions: VideoSyncActions;
  onVideoLoadedMetadata: () => void;

  // ── Handlers ──────────────────────────────────────────────────────────────
  onScrub: (idx: number) => void;
  onLapSelect: (lap: Lap) => void;
  onSetReference: (lapNumber: number) => void;
  onSelectExternalLap: (fileName: string, lapNumber: number) => void;
  onClearExternalRef: () => void;
  onLoadFileForRef: (fileName: string) => Promise<Array<{ lapNumber: number; lapTimeMs: number }> | null>;
  onRefreshSavedFiles: () => void;
  onRangeChange: (range: [number, number]) => void;
  onFieldToggle: (fieldName: string) => void;
  onWeatherStationResolved: (station: WeatherStation) => void;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
  /** Open the file-manager drawer, optionally straight to a Garage sub-tab. */
  onOpenGarage: (garageTab?: 'files' | 'vehicles' | 'setups') => void;
  formatRangeLabel: (idx: number) => string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children, value,
}: { children: React.ReactNode; value: SessionContextValue }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- useSessionContext hook is conventionally co-located with SessionProvider
export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within SessionProvider');
  return ctx;
}

// Non-throwing variant for surfaces that may render outside a session (e.g. the
// Profile drawer tab, which is also reachable from the landing page before any
// file is loaded). Returns null when no SessionProvider is mounted.
// eslint-disable-next-line react-refresh/only-export-components -- co-located with SessionProvider
export function useOptionalSessionContext(): SessionContextValue | null {
  return useContext(SessionContext);
}
