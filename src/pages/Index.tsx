import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Map, ListOrdered, BarChart3, FolderOpen, Play, Pause, Eye, EyeOff, AlertCircle, Wrench, NotebookPen, SlidersHorizontal } from "lucide-react";
import { LandingPage } from "@/components/LandingPage";
import { TrackEditor } from "@/components/TrackEditor"; // still used in compact header
import { LapTimesTab } from "@/components/tabs/LapTimesTab";
import { NotesTab } from "@/components/drawer/NotesTab";
// Heavy tabs lazy-loaded so the initial bundle doesn't carry their deps.
// RaceLine pulls in Leaflet (vendor-leaflet, ~150 kB) + the telemetry chart —
// lazy keeps the whole mapping stack off the landing page; it loads the moment
// a session is opened (the default tab). GraphView pulls in the multi-series
// canvas chart + InfoBox + MiniMap. All load on first render of their tab.
const RaceLineTab = lazy(() =>
  import("@/components/tabs/RaceLineTab").then((m) => ({ default: m.RaceLineTab })),
);
const GraphViewTab = lazy(() =>
  import("@/components/tabs/GraphViewTab").then((m) => ({ default: m.GraphViewTab })),
);
const CoachTab = lazy(() =>
  import("@/components/tabs/CoachTab").then((m) => ({ default: m.CoachTab })),
);
const ToolsTab = lazy(() =>
  import("@/components/tabs/ToolsTab").then((m) => ({ default: m.ToolsTab })),
);
// Setups is a main-view tab built on the same component the garage drawer used.
// Lazy-loaded — it pulls in the template creator + setup-history panel that the
// landing/initial view never needs.
const SetupsTab = lazy(() =>
  import("@/components/drawer/SetupsTab").then((m) => ({ default: m.SetupsTab })),
);
import { InstallPrompt } from "@/components/InstallPrompt";
import { SettingsModal } from "@/components/SettingsModal";
// FileManagerDrawer is a slide-out that only opens on user click. Lazy-loading
// it keeps its transitive deps (drawer tabs, kart/setup/template managers,
// device manager UI) out of the initial bundle.
const FileManagerDrawer = lazy(() =>
  import("@/components/FileManagerDrawer").then((m) => ({ default: m.FileManagerDrawer })),
);
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ParsedData } from "@/types/racing";
import { calculateDistanceArray } from "@/lib/referenceUtils";
import { formatAxisDistance } from "@/lib/chartAxis";
import { usePanelsForSlot, PanelSlot } from "@/plugins/panels";
import { TrackPromptDialog } from "@/components/TrackPromptDialog";
import { useSettings } from "@/hooks/useSettings";
import { usePlayback } from "@/hooks/usePlayback";
import { useFileManager } from "@/hooks/useFileManager";
import { getSetupIndicator, type SetupIndicator } from "@/lib/setupStatus";
import { useVehicleManager } from "@/hooks/useVehicleManager";
import { useNoteManager } from "@/hooks/useNoteManager";
import { useSetupManager } from "@/hooks/useSetupManager";
import { useTemplateManager } from "@/hooks/useTemplateManager";
import { useSessionData } from "@/hooks/useSessionData";
import { useLapManagement } from "@/hooks/useLapManagement";
import { useReferenceLap, useExternalReference } from "@/hooks/useReferenceLap";
import { useLapSnapshots } from "@/hooks/useLapSnapshots";
import { useLapOverlays } from "@/hooks/useLapOverlays";
import type { OverlayLine } from "@/lib/lapOverlays";
import { LapSnapshotControls } from "@/components/LapSnapshotControls";
import { OverlaysMenu } from "@/components/OverlaysMenu";
import { LapSnapshotPromptDialog } from "@/components/LapSnapshotPromptDialog";
import { useSessionMetadata } from "@/hooks/useSessionMetadata";
import { useVideoSync } from "@/hooks/useVideoSync";
import { useDataLoader } from "@/hooks/useDataLoader";
import { ensureSampleFile } from "@/lib/sampleData";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { DeviceProvider } from "@/contexts/DeviceContext";
import { SessionProvider, type SessionContextValue } from "@/contexts/SessionContext";
import { PlaybackProvider, type PlaybackContextValue } from "@/contexts/PlaybackContext";
import { snapshotLapSamples } from "@/lib/lapSnapshot";
import type { PluginSnapshot } from "@/plugins/panels";


type TopPanelView = "raceline" | "laptable" | "graphview" | "coach" | "tools" | "setups" | "notes";

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';
const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';

export default function Index() {
  const { t } = useTranslation("session");
  const { settings, setSettings, toggleFieldDefault, isFieldHiddenByDefault } = useSettings();
  const fileManager = useFileManager();
  const vehicleManager = useVehicleManager();
  const setupManager = useSetupManager();
  const templateManager = useTemplateManager();
  const useKph = settings.useKph;
  const useMetricDistance = settings.useMetricDistance;
  // The sample stays visible when it's the user's only file, so hiding it can
  // never lock them out of the only file (and the only way back to Settings).
  const effectiveShowSampleFiles = fileManager.hasOtherFiles ? settings.showSampleFiles : true;

  // Sync dark mode class when settings change (global init is in App.tsx)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.darkMode);
  }, [settings.darkMode]);

  // Seed the bundled sample log into IndexedDB as a real file so it's always
  // available in the browser and opens through the normal path. Idempotent;
  // refresh the file list afterwards so an open drawer reflects it immediately.
  const refreshFiles = fileManager.refresh;
  useEffect(() => {
    void ensureSampleFile().then(() => refreshFiles());
  }, [refreshFiles]);

  // Core session data
  const sessionData = useSessionData(isFieldHiddenByDefault, settings.defaultHiddenFields);
  const { data, currentFileName, fieldMappings, sessionGpsPoint } = sessionData;

  const noteManager = useNoteManager(currentFileName);

  // Lap management
  const lapMgmt = useLapManagement(data, currentFileName);
  const {
    selection, selectedCourse, laps, selectedLapNumber, referenceLapNumber,
    filteredSamples, visibleSamples, visibleRange, currentIndex, filteredBounds,
    setSelectedLapNumber, setReferenceLapNumber, setCurrentIndex,
    handleSelectionChange, handleLapSelect, handleLapDropdownChange,
    handleSetReference, handleScrub, handleRangeChange, formatRangeLabel: formatRangeLabelTime,
  } = lapMgmt;

  // External reference
  const externalRef = useExternalReference(selectedCourse);
  const {
    externalRefSamples, externalRefLabel, savedFiles,
    refreshSavedFiles, handleLoadFileForRef, handleSelectExternalLap, handleClearExternalRef,
  } = externalRef;

  // Reference lap comparison
  const refLap = useReferenceLap(
    data, laps, selectedCourse, filteredSamples, selectedLapNumber,
    referenceLapNumber, externalRefSamples, useKph,
    settings.deltaMethod, settings.deltaSampleMeters
  );
  const {
    referenceSamples, paceData, referenceSpeedData, lapToFastestDelta,
    paceDiff, paceDiffLabel, deltaTopSpeed, deltaMinSpeed, refAvgTopSpeed, refAvgMinSpeed,
  } = refLap;

  // Session metadata
  const sessionMeta = useSessionMetadata(currentFileName);
  const { cachedWeatherStation, sessionKartId, sessionSetupId, sessionSetupRev, postSession } = sessionMeta;

  // Playback
  const { isPlaying, toggle: togglePlayback, averageFrameRate } = usePlayback({
    samples: visibleSamples,
    currentIndex,
    onIndexChange: setCurrentIndex,
    visibleRange,
  });

  const [topPanelView, setTopPanelView] = useState<TopPanelView>("raceline");
  const [showOverlays, setShowOverlays] = useState(true);
  // Plugin panels drive these tabs. A plugin's `setup` may register panels
  // asynchronously (after this first render), so we read them through the
  // reactive hook — a plain useMemo([]) would freeze the snapshot and the tabs
  // would never appear that session.
  // The Coach tab is self-gating: it appears only when a plugin contributes a
  // panel to the Coach slot (i.e. the coach package is installed).
  const showCoach = usePanelsForSlot(PanelSlot.Coach).length > 0;
  // Tools tab is self-gating like Coach: it appears only when a plugin
  // contributes a panel to the Tools slot (the first-party tools plugin does).
  const showTools = usePanelsForSlot(PanelSlot.Tools).length > 0;
  // Profile tab is self-gating too: appears only when a plugin (cloud-sync)
  // contributes a Profile panel (i.e. the cloud build flag is on).
  const showProfile = usePanelsForSlot(PanelSlot.Profile).length > 0;

  // Setup-status nag: when the loaded session has no setup assigned, glow an
  // exclamation in the tab bar (decision lives in the pure getSetupIndicator).
  const setupIndicator = useMemo(
    () => getSetupIndicator({
      sessionSetupId,
      setupCount: setupManager.setups.length,
      vehicleCount: vehicleManager.vehicles.length,
    }),
    [sessionSetupId, setupManager.setups.length, vehicleManager.vehicles.length],
  );

  // Vehicle/setup/notes navigation: setups + notes are main-view tabs, vehicles
  // (and files) still live in the garage drawer. One callback routes either way
  // so callers (InfoBox "Open Garage", the setup-status nag) stay agnostic.
  const navigateToManage = useCallback((target?: "files" | "vehicles" | "setups" | "notes") => {
    if (target === "setups" || target === "notes") setTopPanelView(target);
    else fileManager.open(target);
  }, [fileManager]);

  // Video sync for the video player
  const videoSync = useVideoSync({
    samples: visibleSamples,
    allSamples: data?.samples ?? [],
    currentIndex,
    onScrub: handleScrub,
    sessionFileName: currentFileName,
  });
  const currentSample = visibleSamples[currentIndex] ?? null;

  // Data loading orchestration — owns the track-prompt UI state and the
  // sample-loader. Returns the three callbacks Index.tsx wires up to imports.
  const dataLoader = useDataLoader({ sessionData, lapMgmt, sessionMeta });
  const {
    handleDataLoaded, handleLoadSample, isLoadingSample, handleTrackPromptSelect,
    trackPromptOpen, setTrackPromptOpen, detectedTrack, detectionResult,
    allTracks, gpsCenter,
  } = dataLoader;

  // Lap snapshots: frozen "course fastest lap" captures, loaded as a comparison
  // overlay through the same external-reference slot (so they never auto-play or
  // appear in the video player).
  const loadSnapshotOverlay = useCallback((samples: typeof filteredSamples, label: string) => {
    externalRef.setExternalRefSamples(samples);
    externalRef.setExternalRefLabel(label);
    setReferenceLapNumber(null);
  }, [externalRef, setReferenceLapNumber]);

  const snapshots = useLapSnapshots({
    data,
    laps,
    selection,
    selectedLapNumber,
    currentFileName,
    vehicles: vehicleManager.vehicles,
    setups: setupManager.setups,
    sessionKartId,
    sessionSetupId,
    onLoadOverlay: loadSnapshotOverlay,
    onClearOverlay: handleClearExternalRef,
  });

  // Multi-lap overlay (maps + graphs): which laps/snapshots/external-file laps
  // to draw, plus cross-session drift alignment.
  const {
    overlaySelections, overlayLines, toggleOverlay,
    alignOverlays, toggleAlignOverlays, showOverlayLegend, toggleOverlayLegend,
    loadOverlayFile, addExternalOverlay,
  } = useLapOverlays({
    data,
    laps,
    snapshotsForCourse: snapshots.snapshotsForCourse,
    selectedCourse,
    currentLapSamples: filteredSamples,
  });

  // Reference-lap handlers: clear the other side when one is set.
  const handleSetReferenceWithClear = useCallback((lapNumber: number) => {
    handleSetReference(lapNumber);
    externalRef.setExternalRefSamples(null);
    externalRef.setExternalRefLabel(null);
    snapshots.setActiveSnapshotId(null);
  }, [handleSetReference, externalRef, snapshots]);

  const handleSelectExternalLapWithClear = useCallback((fileName: string, lapNumber: number) => {
    handleSelectExternalLap(fileName, lapNumber);
    setReferenceLapNumber(null);
    snapshots.setActiveSnapshotId(null);
  }, [handleSelectExternalLap, setReferenceLapNumber, snapshots]);

  // Promote one of the active overlay lines to the comparison reference lap. A
  // same-session `lap:` overlay sets the in-session reference (so it highlights
  // in the lap table); cross-session overlays feed the external-reference slot.
  const handleSetOverlayReference = useCallback((line: OverlayLine) => {
    if (line.id.startsWith('lap:')) {
      const lapNumber = Number(line.id.slice(line.id.indexOf(':') + 1));
      if (Number.isFinite(lapNumber)) {
        handleSetReferenceWithClear(lapNumber);
        return;
      }
    }
    externalRef.setExternalRefSamples(line.samples);
    externalRef.setExternalRefLabel(line.label);
    setReferenceLapNumber(null);
    snapshots.setActiveSnapshotId(null);
  }, [handleSetReferenceWithClear, externalRef, setReferenceLapNumber, snapshots]);

  // Assigning an engine/setup may set a new course fastest lap → prompt to save.
  const handleSaveSessionSetupWithSnapshot = useCallback(async (kartId: string | null, setupId: string | null) => {
    // Snapshot the engine string for the file browser's engine grouping, so it
    // survives later edits/deletes of the vehicle.
    const engine = kartId ? vehicleManager.vehicles.find((v) => v.id === kartId)?.engine ?? null : null;
    await sessionMeta.handleSaveSessionSetup(kartId, setupId, engine);
    snapshots.maybePromptOnAssignment(kartId, setupId);
  }, [sessionMeta, snapshots, vehicleManager.vehicles]);

  // Clearing the shared reference slot (e.g. the ExternalRefBar X) must also drop
  // the active snapshot, since a loaded snapshot rides that same slot.
  const handleClearExternalRefWithSnapshot = useCallback(() => {
    handleClearExternalRef();
    snapshots.setActiveSnapshotId(null);
  }, [handleClearExternalRef, snapshots]);

  const hasReference = referenceLapNumber !== null || externalRefSamples !== null;

  const brakingZoneSettings = useMemo(() => ({
    entryThresholdG: settings.brakingEntryThreshold / 100,
    exitThresholdG: settings.brakingExitThreshold / 100,
    minDurationMs: settings.brakingMinDuration,
    smoothingAlpha: settings.brakingSmoothingAlpha / 100,
    color: settings.brakingZoneColor,
    width: settings.brakingZoneWidth,
    graphWindow: settings.brakingGraphWindow,
    brakeMaxG: (settings.brakeMaxG ?? 150) / 100,
  }), [settings.brakingEntryThreshold, settings.brakingExitThreshold, settings.brakingMinDuration, settings.brakingSmoothingAlpha, settings.brakingZoneColor, settings.brakingZoneWidth, settings.brakingGraphWindow, settings.brakeMaxG]);

  const selectedLapTimeMs = selectedLapNumber !== null
    ? (laps.find((l) => l.lapNumber === selectedLapNumber)?.lapTimeMs ?? null)
    : null;

  const isAllLaps = selectedLapNumber === null;
  const minRange = Math.min(10, Math.floor(filteredSamples.length / 10));

  // Crop-handle labels follow the chart X-axis scale: cumulative distance from
  // the lap start (start-finish line) in distance mode, elapsed time otherwise.
  const filteredDistances = useMemo(
    () => (settings.chartXAxis === 'distance' ? calculateDistanceArray(filteredSamples) : null),
    [settings.chartXAxis, filteredSamples],
  );
  const formatRangeLabel = useCallback(
    (idx: number) => {
      if (filteredDistances) {
        const d = filteredDistances[idx];
        return d === undefined ? "" : formatAxisDistance(d, useMetricDistance);
      }
      return formatRangeLabelTime(idx);
    },
    [filteredDistances, useMetricDistance, formatRangeLabelTime],
  );

  const settingsContextValue = useMemo(() => ({
    useKph,
    useMetricDistance,
    useMetricWeather: settings.useMetricWeather,
    gForceSmoothing: settings.gForceSmoothing,
    gForceSmoothingStrength: settings.gForceSmoothingStrength,
    brakingZoneSettings,
    darkMode: settings.darkMode,
    gForceSource: settings.gForceSource,
    chartXAxis: settings.chartXAxis,
  }), [useKph, useMetricDistance, settings.useMetricWeather, settings.gForceSmoothing, settings.gForceSmoothingStrength, brakingZoneSettings, settings.darkMode, settings.gForceSource, settings.chartXAxis]);

  // Memoize sliced data arrays to avoid recreating on every render
  const slicedPaceData = useMemo(
    () => paceData.slice(visibleRange[0], visibleRange[1] + 1),
    [paceData, visibleRange]
  );
  const slicedReferenceSpeedData = useMemo(
    () => referenceSpeedData.slice(visibleRange[0], visibleRange[1] + 1),
    [referenceSpeedData, visibleRange]
  );

  // The setup the driver is currently running, resolved for plugin panels.
  const sessionSetup = useMemo(
    () => (sessionSetupId ? setupManager.setups.find((s) => s.id === sessionSetupId) ?? null : null),
    [sessionSetupId, setupManager.setups],
  );

  // The loaded reference snapshot as a clean-lap view for plugin panels (coach).
  const activeSnapshot = useMemo<PluginSnapshot | null>(() => {
    const id = snapshots.activeSnapshotId;
    if (!id) return null;
    const snap = snapshots.snapshots.find((s) => s.id === id);
    if (!snap) return null;
    return {
      id: snap.id,
      engine: snap.engine,
      trackName: snap.trackName,
      courseName: snap.courseName,
      lapTimeMs: snap.lapTimeMs,
      sourceFileName: snap.sourceFileName,
      sourceLapNumber: snap.sourceLapNumber,
      recordedAt: snap.recordedAt,
      samples: snapshotLapSamples(snap),
      course: snap.course,
      vehicle: snap.vehicle,
      setup: snap.setup,
    };
  }, [snapshots.activeSnapshotId, snapshots.snapshots]);

  // ── PlaybackContext: just the cursor, updated at playback rate ──────────
  // Kept out of the big session context so a tick only re-renders the
  // components that actually track the cursor (charts, maps, video player).
  const playbackContextValue = useMemo<PlaybackContextValue>(
    () => ({ currentIndex, currentSample }),
    [currentIndex, currentSample],
  );

  // ── SessionContext: everything the three main view tabs need ────────────
  // Tabs read this via `useSessionContext()` instead of receiving 25+ props.
  // Must stay referentially stable during playback — the cursor lives in
  // PlaybackContext, and every dep here must not churn per tick.
  const sessionContextValue = useMemo<SessionContextValue>(() => ({
    data,
    visibleSamples,
    filteredSamples,
    allSamples: data?.samples ?? [],
    referenceSamples,
    fieldMappings,
    visibleRange,
    minRange,
    course: selectedCourse,
    bounds: filteredBounds ?? null,
    laps,
    selectedLapNumber,
    selectedLapTimeMs,
    referenceLapNumber,
    isAllLaps,
    hasReference,
    paceDiff,
    paceDiffLabel,
    paceData: slicedPaceData,
    referenceSpeedData: slicedReferenceSpeedData,
    deltaTopSpeed,
    deltaMinSpeed,
    lapToFastestDelta,
    refAvgTopSpeed,
    refAvgMinSpeed,
    externalRefLabel,
    savedFiles,
    snapshotsForCourse: snapshots.snapshotsForCourse,
    activeSnapshotId: snapshots.activeSnapshotId,
    activeSnapshot,
    sessionSetup,
    canSnapshot: snapshots.canSnapshot,
    onLoadSnapshot: snapshots.loadSnapshot,
    onClearSnapshot: snapshots.clearActive,
    onSaveSnapshot: snapshots.saveSelectedLap,
    overlaySelections,
    overlayLines,
    onToggleOverlay: toggleOverlay,
    alignOverlays,
    onToggleAlignOverlays: toggleAlignOverlays,
    showOverlayLegend,
    onToggleOverlayLegend: toggleOverlayLegend,
    onLoadOverlayFile: loadOverlayFile,
    onAddExternalOverlay: addExternalOverlay,
    sessionGpsPoint,
    sessionStartDate: data?.startDate,
    sessionFileName: currentFileName,
    sessionKartId,
    sessionSetupId,
    cachedWeatherStation,
    parserStats: data?.parserStats,
    vehicles: vehicleManager.vehicles,
    setups: setupManager.setups,
    templates: templateManager.templates,
    videoState: videoSync.state,
    videoActions: videoSync.actions,
    onVideoLoadedMetadata: videoSync.handleLoadedMetadata,
    onScrub: handleScrub,
    onLapSelect: handleLapSelect,
    onSetReference: handleSetReferenceWithClear,
    onSelectExternalLap: handleSelectExternalLapWithClear,
    onClearExternalRef: handleClearExternalRefWithSnapshot,
    onLoadFileForRef: handleLoadFileForRef,
    onRefreshSavedFiles: refreshSavedFiles,
    onRangeChange: handleRangeChange,
    onFieldToggle: sessionData.handleFieldToggle,
    onWeatherStationResolved: sessionMeta.handleWeatherStationResolved,
    onSaveSessionSetup: handleSaveSessionSetupWithSnapshot,
    onOpenGarage: navigateToManage,
    formatRangeLabel,
  }), [
    data, visibleSamples, filteredSamples, referenceSamples, fieldMappings,
    visibleRange, minRange,
    selectedCourse, filteredBounds,
    laps, selectedLapNumber, selectedLapTimeMs, referenceLapNumber, isAllLaps,
    hasReference, paceDiff, paceDiffLabel, slicedPaceData, slicedReferenceSpeedData,
    deltaTopSpeed, deltaMinSpeed, lapToFastestDelta, refAvgTopSpeed, refAvgMinSpeed,
    externalRefLabel, savedFiles,
    snapshots.snapshotsForCourse, snapshots.activeSnapshotId, snapshots.canSnapshot,
    snapshots.loadSnapshot, snapshots.clearActive, snapshots.saveSelectedLap,
    overlaySelections, overlayLines, toggleOverlay,
    alignOverlays, toggleAlignOverlays, showOverlayLegend, toggleOverlayLegend,
    loadOverlayFile, addExternalOverlay,
    activeSnapshot, sessionSetup,
    sessionGpsPoint, currentFileName, sessionKartId, sessionSetupId, cachedWeatherStation,
    vehicleManager.vehicles, setupManager.setups, templateManager.templates,
    videoSync.state, videoSync.actions, videoSync.handleLoadedMetadata,
    handleScrub, handleLapSelect, handleSetReferenceWithClear,
    handleSelectExternalLapWithClear, handleClearExternalRefWithSnapshot, handleLoadFileForRef,
    refreshSavedFiles, handleRangeChange,
    sessionData.handleFieldToggle, sessionMeta.handleWeatherStationResolved,
    handleSaveSessionSetupWithSnapshot, navigateToManage, formatRangeLabel,
  ]);

  // Shared FileManagerDrawer props
  const fileManagerProps = useMemo(() => ({
    isOpen: fileManager.isOpen,
    files: fileManager.files,
    fileMetadataMap: fileManager.fileMetadataMap,
    storageUsed: fileManager.storageUsed,
    storageQuota: fileManager.storageQuota,
    onClose: fileManager.close,
    onLoadFile: fileManager.loadFile,
    onDeleteFile: fileManager.removeFile,
    onExportFile: fileManager.exportFile,
    onSaveFile: fileManager.saveFile,
    onDataLoaded: handleDataLoaded,
    autoSave: settings.autoSaveFiles,
    showSampleFiles: effectiveShowSampleFiles,
    initialGarageTab: fileManager.initialGarageTab,
    showProfile,
    vehicles: vehicleManager.vehicles,
    vehicleTypes: templateManager.vehicleTypes,
    onAddVehicle: vehicleManager.addVehicle,
    onUpdateVehicle: vehicleManager.updateVehicle,
    onRemoveVehicle: vehicleManager.removeVehicle,
    currentTrackName: lapMgmt.selection?.trackName ?? null,
    currentCourseName: lapMgmt.selection?.courseName ?? null,
  }), [
    fileManager.isOpen, fileManager.files, fileManager.fileMetadataMap, fileManager.storageUsed, fileManager.storageQuota,
    fileManager.close, fileManager.loadFile, fileManager.removeFile, fileManager.exportFile, fileManager.saveFile,
    fileManager.initialGarageTab,
    handleDataLoaded, settings.autoSaveFiles, effectiveShowSampleFiles, showProfile,
    vehicleManager.vehicles, vehicleManager.addVehicle, vehicleManager.updateVehicle, vehicleManager.removeVehicle,
    templateManager.vehicleTypes,
    lapMgmt.selection,
  ]);

  // No data loaded - show import UI
  if (!data) {
    return (
      <DeviceProvider>
        <>
          <InstallPrompt />
          <LandingPage
            onDataLoaded={handleDataLoaded}
            onOpenFileManager={fileManager.open}
            autoSave={settings.autoSaveFiles}
            autoSaveFile={fileManager.saveFile}
            onLoadSample={handleLoadSample}
            isLoadingSample={isLoadingSample}
            showSampleFiles={effectiveShowSampleFiles}
            enableAdmin={enableAdmin}
            enableCloud={enableCloud}
          />
          <Suspense fallback={null}>
            <FileManagerDrawer {...fileManagerProps} />
          </Suspense>
        </>
      </DeviceProvider>
    );
  }

  
  // Data loaded - show main view
    return (
    <DeviceProvider>
    <SettingsProvider value={settingsContextValue}>
    <SessionProvider value={sessionContextValue}>
    <PlaybackProvider value={playbackContextValue}>
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Gauge className="w-6 h-6 text-primary" />
          <span className="font-semibold text-foreground hidden sm:inline">HackTheTrack.net</span>
        </div>

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={togglePlayback}>
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isPlaying ? t("header.pause") : t("header.play")} ({averageFrameRate ? `${averageFrameRate.toFixed(0)} Hz` : "–"})</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TrackEditor selection={selection} onSelectionChange={handleSelectionChange} compact laps={laps} samples={data?.samples} />

          {laps.length > 0 && (
            <Select value={selectedLapNumber?.toString() ?? "all"} onValueChange={handleLapDropdownChange}>
              <SelectTrigger className="w-auto gap-1 h-8 px-2 text-sm">
                <SelectValue placeholder={t("header.allLaps")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("header.allLaps")}</SelectItem>
                {laps.map((lap) => (
                  <SelectItem key={lap.lapNumber} value={lap.lapNumber.toString()}>
                    {t("header.lap", { number: lap.lapNumber })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <LapSnapshotControls
            snapshotsForCourse={snapshots.snapshotsForCourse}
            activeSnapshotId={snapshots.activeSnapshotId}
            canSnapshot={snapshots.canSnapshot}
            hasCourse={!!selectedCourse}
            onLoad={snapshots.loadSnapshot}
            onClear={snapshots.clearActive}
            onSave={snapshots.saveSelectedLap}
            overlayLines={overlayLines}
            onToggleOverlay={toggleOverlay}
          />

          <OverlaysMenu
            hasCourse={!!selectedCourse}
            trackName={selection?.trackName}
            courseName={selectedCourse?.name}
            currentFileName={currentFileName}
            laps={laps}
            overlayLines={overlayLines}
            referenceLapNumber={referenceLapNumber}
            externalRefLabel={externalRefLabel}
            onLoadOverlayFile={loadOverlayFile}
            onAddExternalOverlay={addExternalOverlay}
            onToggleOverlay={toggleOverlay}
            onSetOverlayReference={handleSetOverlayReference}
          />

          <SettingsModal settings={settings} onSettingsChange={setSettings} onToggleFieldDefault={toggleFieldDefault} canHideSampleFiles={fileManager.hasOtherFiles} />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 lg:px-3" onClick={() => fileManager.open()}>
            <FolderOpen className="w-4 h-4" />
            <span className="hidden lg:inline">{t("header.garage")}</span>
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <TabBar topPanelView={topPanelView} setTopPanelView={setTopPanelView} laps={laps} showOverlays={showOverlays} onToggleOverlays={() => setShowOverlays(v => !v)} showCoach={showCoach} showTools={showTools} setupIndicator={setupIndicator} onSetupIndicatorClick={() => setupIndicator && navigateToManage(setupIndicator.target)} />


        <div className="flex-1 min-h-0 overflow-hidden">
          {topPanelView === "laptable" && <LapTimesTab />}
          {topPanelView === "notes" && (
            <div className="h-full flex flex-col max-w-2xl mx-auto w-full">
              <NotesTab
                fileName={currentFileName}
                notes={noteManager.notes}
                onAdd={noteManager.addNote}
                onUpdate={noteManager.updateNote}
                onRemove={noteManager.removeNote}
                vehicles={vehicleManager.vehicles}
                setups={setupManager.setups}
                sessionKartId={sessionKartId}
                sessionSetupId={sessionSetupId}
                sessionSetupRev={sessionSetupRev}
                onSaveSessionSetup={handleSaveSessionSetupWithSnapshot}
                postSession={postSession}
                onSavePostSession={sessionMeta.handleSavePostSession}
              />
            </div>
          )}
          <Suspense fallback={null}>
            {topPanelView === "raceline" && <RaceLineTab showOverlays={showOverlays} />}
            {topPanelView === "graphview" && <GraphViewTab />}
            {topPanelView === "coach" && showCoach && <CoachTab />}
            {topPanelView === "tools" && showTools && <ToolsTab />}
            {topPanelView === "setups" && (
              <div className="h-full flex flex-col max-w-2xl mx-auto w-full">
                <SetupsTab
                  vehicles={vehicleManager.vehicles}
                  setups={setupManager.setups}
                  vehicleTypes={templateManager.vehicleTypes}
                  templates={templateManager.templates}
                  onAdd={setupManager.addSetup}
                  onUpdate={setupManager.updateSetup}
                  onRemove={setupManager.removeSetup}
                  onGetLatestForVehicle={setupManager.getLatestForVehicle}
                  onAddVehicleType={templateManager.addVehicleType}
                  onRemoveVehicleType={templateManager.removeVehicleType}
                />
              </div>
            )}
          </Suspense>
        </div>
      </main>
      <InstallPrompt />
      <Suspense fallback={null}>
        <FileManagerDrawer {...fileManagerProps} />
      </Suspense>
      <TrackPromptDialog
        open={trackPromptOpen}
        onOpenChange={setTrackPromptOpen}
        detectedTrack={detectedTrack}
        tracks={allTracks}
        onSelect={handleTrackPromptSelect}
        initialCenter={gpsCenter}
        detectionResult={detectionResult}
        laps={laps}
        samples={data?.samples}
      />
      <LapSnapshotPromptDialog
        prompt={snapshots.prompt}
        onConfirm={snapshots.confirmPrompt}
        onDismiss={snapshots.dismissPrompt}
      />
    </div>
    </PlaybackProvider>
    </SessionProvider>
    </SettingsProvider>
    </DeviceProvider>
  );
}

/** Tab navigation bar for the main data view */
function TabBar({ topPanelView, setTopPanelView, laps, showOverlays, onToggleOverlays, showCoach, showTools, setupIndicator, onSetupIndicatorClick }: {
  topPanelView: TopPanelView;
  setTopPanelView: (view: TopPanelView) => void;
  laps: { lapNumber: number }[];
  showOverlays: boolean;
  onToggleOverlays: () => void;
  showCoach: boolean;
  showTools: boolean;
  setupIndicator: SetupIndicator | null;
  onSetupIndicatorClick: () => void;
}) {
  const { t } = useTranslation("session");
  const tabClass = (view: TopPanelView) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
      topPanelView === view
        ? "text-primary border-b-2 border-primary bg-primary/5"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex items-center border-b border-border shrink-0">
      <button onClick={() => setTopPanelView("raceline")} className={tabClass("raceline")}>
        <Map className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.simple")}</span>
      </button>
      <button onClick={() => setTopPanelView("graphview")} className={tabClass("graphview")}>
        <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.pro")}</span>
      </button>
      <button onClick={() => setTopPanelView("laptable")} className={tabClass("laptable")}>
        <ListOrdered className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.lapTimes")}</span>
        {laps.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">{laps.length}</span>
        )}
      </button>
      {showCoach && (
        <button onClick={() => setTopPanelView("coach")} className={tabClass("coach")}>
          <Gauge className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.coach")}</span>
        </button>
      )}
      {showTools && (
        <button onClick={() => setTopPanelView("tools")} className={tabClass("tools")}>
          <Wrench className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.tools")}</span>
        </button>
      )}
      <button onClick={() => setTopPanelView("setups")} className={tabClass("setups")}>
        <SlidersHorizontal className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.setups")}</span>
      </button>
      <button onClick={() => setTopPanelView("notes")} className={tabClass("notes")}>
        <NotebookPen className="w-4 h-4" /> <span className="hidden sm:inline">{t("tabs.notes")}</span>
      </button>
      {setupIndicator && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSetupIndicatorClick}
                aria-label={t("header.setupNotConfigured")}
                className={`flex items-center px-3 py-2 animate-pulse transition-opacity hover:opacity-70 ${
                  setupIndicator.tone === "red"
                    ? "text-destructive drop-shadow-[0_0_6px_hsl(var(--destructive))]"
                    : "text-orange-500 drop-shadow-[0_0_6px_rgba(249,115,22,0.85)]"
                }`}
              >
                <AlertCircle className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {setupIndicator.tone === "red"
                  ? t("header.setupNoneRed")
                  : t("header.setupNoneOrange")}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {topPanelView === "raceline" && (
        <div className="ml-auto mr-3">
          <Button variant="ghost" size="sm" onClick={onToggleOverlays} className="h-7 px-2 gap-1.5">
            {showOverlays ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span className="text-xs hidden sm:inline">{t("header.overlay")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
