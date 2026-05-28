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
import type { SaveSnapshotResult } from '@/hooks/useLapSnapshots';
import type { PluginSnapshot } from '@/plugins/panels';

/**
 * Session-scoped state and handlers shared by the three main view tabs
 * (RaceLineTab, LapTimesTab, GraphViewTab).
 *
 * Tabs read this via `useSessionContext()` instead of receiving 25+ props
 * from Index.tsx. The underlying view components (RaceLineView, LapTable,
 * GraphViewPanel) still receive everything as props for now — pushing the
 * context boundary deeper can come in a follow-up if needed.
 */
export interface SessionContextValue {
  // ── Sample data ───────────────────────────────────────────────────────────
  data: ParsedData | null;
  visibleSamples: GpsSample[];
  filteredSamples: GpsSample[];
  allSamples: GpsSample[];
  referenceSamples: GpsSample[];
  currentSample: GpsSample | null;
  fieldMappings: FieldMapping[];

  // ── Position / range ──────────────────────────────────────────────────────
  currentIndex: number;
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
  canSnapshot: boolean;
  onLoadSnapshot: (snap: LapSnapshot) => void;
  onClearSnapshot: () => void;
  onSaveSnapshot: () => Promise<SaveSnapshotResult>;

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
