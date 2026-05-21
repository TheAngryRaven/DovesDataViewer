import { useCallback, useEffect, useMemo, useState } from "react";
import { Gauge, Map, ListOrdered, BarChart3, FolderOpen, Play, Pause, Eye, EyeOff, FlaskConical } from "lucide-react";
import { LandingPage } from "@/components/LandingPage";
import { TrackEditor } from "@/components/TrackEditor"; // still used in compact header
import { RaceLineTab } from "@/components/tabs/RaceLineTab";
import { LapTimesTab } from "@/components/tabs/LapTimesTab";
import { GraphViewTab } from "@/components/tabs/GraphViewTab";
import { LabsTab } from "@/components/tabs/LabsTab";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SettingsModal } from "@/components/SettingsModal";
import { FileManagerDrawer } from "@/components/FileManagerDrawer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ParsedData, Track, TrackCourseSelection, CourseDetectionResult } from "@/types/racing";
import { getFileMetadata } from "@/lib/fileStorage";
import { loadTracks } from "@/lib/trackStorage";
import { findNearestTrack } from "@/lib/trackUtils";
import { autoDetectCourse } from "@/lib/courseDetection";
import { TrackPromptDialog } from "@/components/TrackPromptDialog";
import { useSettings } from "@/hooks/useSettings";
import { usePlayback } from "@/hooks/usePlayback";
import { useFileManager } from "@/hooks/useFileManager";
import { useVehicleManager } from "@/hooks/useVehicleManager";
import { useNoteManager } from "@/hooks/useNoteManager";
import { useSetupManager } from "@/hooks/useSetupManager";
import { useTemplateManager } from "@/hooks/useTemplateManager";
import { useSessionData } from "@/hooks/useSessionData";
import { useLapManagement } from "@/hooks/useLapManagement";
import { useReferenceLap, useExternalReference } from "@/hooks/useReferenceLap";
import { useSessionMetadata } from "@/hooks/useSessionMetadata";
import { useVideoSync } from "@/hooks/useVideoSync";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { DeviceProvider } from "@/contexts/DeviceContext";
import { SessionProvider, type SessionContextValue } from "@/contexts/SessionContext";


type TopPanelView = "raceline" | "laptable" | "graphview" | "labs";

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';

export default function Index() {
  const { settings, setSettings, toggleFieldDefault, isFieldHiddenByDefault } = useSettings();
  const fileManager = useFileManager();
  const vehicleManager = useVehicleManager();
  const setupManager = useSetupManager();
  const templateManager = useTemplateManager();
  const useKph = settings.useKph;

  // Sync dark mode class when settings change (global init is in App.tsx)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.darkMode);
  }, [settings.darkMode]);

  // Core session data
  const sessionData = useSessionData(isFieldHiddenByDefault, settings.defaultHiddenFields);
  const { data, currentFileName, fieldMappings, isLoadingSample, sessionGpsPoint } = sessionData;

  const noteManager = useNoteManager(currentFileName);

  // Lap management
  const lapMgmt = useLapManagement(data, currentFileName);
  const {
    selection, selectedCourse, laps, selectedLapNumber, referenceLapNumber,
    filteredSamples, visibleSamples, visibleRange, currentIndex, filteredBounds,
    setSelectedLapNumber, setReferenceLapNumber, setCurrentIndex,
    handleSelectionChange, handleLapSelect, handleLapDropdownChange,
    handleSetReference, handleScrub, handleRangeChange, formatRangeLabel,
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
    referenceLapNumber, externalRefSamples, useKph
  );
  const {
    referenceSamples, paceData, referenceSpeedData, lapToFastestDelta,
    paceDiff, paceDiffLabel, deltaTopSpeed, deltaMinSpeed, refAvgTopSpeed, refAvgMinSpeed,
  } = refLap;

  // Session metadata
  const sessionMeta = useSessionMetadata(currentFileName);
  const { cachedWeatherStation, sessionKartId, sessionSetupId } = sessionMeta;

  // Playback
  const { isPlaying, toggle: togglePlayback, averageFrameRate } = usePlayback({
    samples: visibleSamples,
    currentIndex,
    onIndexChange: setCurrentIndex,
    visibleRange,
  });

  const [topPanelView, setTopPanelView] = useState<TopPanelView>("raceline");
  const [showOverlays, setShowOverlays] = useState(true);
  const [trackPromptOpen, setTrackPromptOpen] = useState(false);
  const [detectedTrack, setDetectedTrack] = useState<Track | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [gpsCenter, setGpsCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [detectionResult, setDetectionResult] = useState<CourseDetectionResult | null>(null);

  // Video sync for Labs tab
  const videoSync = useVideoSync({
    samples: visibleSamples,
    allSamples: data?.samples ?? [],
    currentIndex,
    onScrub: handleScrub,
    sessionFileName: currentFileName,
  });
  const currentSample = visibleSamples[currentIndex] ?? null;

  // Orchestrate data loading — connects sessionData, lapMgmt, and sessionMeta
  const handleDataLoaded = useCallback(
    async (parsedData: ParsedData, fileName?: string) => {
      sessionData.loadParsedData(parsedData, fileName);
      setCurrentIndex(0);

      // Try to restore track selection from metadata
      let courseToUse = selectedCourse;
      let restoredFromMeta = false;
      if (fileName) {
        const meta = await getFileMetadata(fileName);
        if (meta) {
          const tracks = await loadTracks();
          const track = tracks.find((t) => t.name === meta.trackName);
          const course = track?.courses.find((c) => c.name === meta.courseName);
          if (track && course) {
            const restoredSelection: TrackCourseSelection = {
              trackName: track.name,
              courseName: course.name,
              course,
            };
            lapMgmt.setSelection(restoredSelection);
            courseToUse = course;
            restoredFromMeta = true;
          }
          sessionMeta.restoreFromMetadata(meta);
        } else {
          sessionMeta.restoreFromMetadata(null);
        }
      } else {
        sessionMeta.restoreFromMetadata(null);
      }

      // Calculate laps if course is selected
      if (courseToUse) {
        const computedLaps = lapMgmt.calculateAndSetLaps(courseToUse, parsedData.samples, fileName);
        if (computedLaps.length > 0) {
          const fastest = computedLaps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), computedLaps[0]);
          setSelectedLapNumber(fastest.lapNumber);
        }
      } else {
        setSelectedLapNumber(null);
      }

      // Auto-detect track and prompt if not restored from metadata
      if (!restoredFromMeta) {
        const tracks = await loadTracks();
        setAllTracks(tracks);
        const validSample = parsedData.samples.find(
          (s) => s.lat !== 0 && s.lon !== 0 && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
        );
        if (validSample) {
          setGpsCenter({ lat: validSample.lat, lon: validSample.lon });

          // Run auto-detection
          const detection = autoDetectCourse(parsedData.samples, tracks);
          setDetectionResult(detection);

          if (detection && !detection.isWaypointMode) {
            // Auto-detected a real course — apply it directly
            const sel: TrackCourseSelection = {
              trackName: detection.track.name,
              courseName: detection.course.name,
              course: detection.course,
            };
            lapMgmt.setSelection(sel);
            lapMgmt.setLaps(detection.laps);
            if (detection.laps.length > 0) {
              const fastest = detection.laps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), detection.laps[0]);
              setSelectedLapNumber(fastest.lapNumber);
            }

            // Course was auto-detected — no need to prompt the user
          } else if (detection && detection.isWaypointMode) {
            // Waypoint mode — apply laps and show prompt
            lapMgmt.setLaps(detection.laps);
            if (detection.laps.length > 0) {
              const fastest = detection.laps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), detection.laps[0]);
              setSelectedLapNumber(fastest.lapNumber);
            }
            setDetectedTrack(null);
            setTrackPromptOpen(true);
          } else {
            // No detection at all
            const nearest = findNearestTrack(validSample.lat, validSample.lon, tracks);
            setDetectedTrack(nearest as Track | null);
            setTrackPromptOpen(true);
          }
        }
      }
    },
    [selectedCourse, sessionData, lapMgmt, sessionMeta, setCurrentIndex, setSelectedLapNumber]
  );

  // Wire up sample loading
  const handleLoadSample = useCallback(async () => {
    await sessionData.handleLoadSample(
      handleSelectionChange,
      (computedLaps, autoSelectLap, autoSelectRef) => {
        lapMgmt.setLaps(computedLaps);
        if (autoSelectLap !== undefined) setSelectedLapNumber(autoSelectLap);
        if (autoSelectRef !== undefined) setReferenceLapNumber(autoSelectRef);
      }
    );
    // Restore session metadata (kart/setup link) for the sample file
    const sampleFileName = "okc-tillotson-data.dovex";
    const meta = await getFileMetadata(sampleFileName);
    sessionMeta.restoreFromMetadata(meta);
  }, [sessionData, handleSelectionChange, lapMgmt, setSelectedLapNumber, setReferenceLapNumber, sessionMeta]);

  // Wire up reference setting to also clear external ref
  const handleSetReferenceWithClear = useCallback((lapNumber: number) => {
    handleSetReference(lapNumber);
    externalRef.setExternalRefSamples(null);
    externalRef.setExternalRefLabel(null);
  }, [handleSetReference, externalRef]);

  // Wire up external lap selection to clear internal ref
  const handleSelectExternalLapWithClear = useCallback((fileName: string, lapNumber: number) => {
    handleSelectExternalLap(fileName, lapNumber);
    setReferenceLapNumber(null);
  }, [handleSelectExternalLap, setReferenceLapNumber]);

  const hasReference = referenceLapNumber !== null || externalRefSamples !== null;

  // Handle course selection from the track prompt dialog
  const handleTrackPromptSelect = useCallback((sel: TrackCourseSelection) => {
    handleSelectionChange(sel);
    if (data) {
      const computedLaps = lapMgmt.calculateAndSetLaps(sel.course, data.samples);
      if (computedLaps.length > 0) {
        const fastest = computedLaps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), computedLaps[0]);
        setSelectedLapNumber(fastest.lapNumber);
      }
    }
  }, [handleSelectionChange, data, lapMgmt, setSelectedLapNumber]);

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

  const settingsContextValue = useMemo(() => ({
    useKph,
    gForceSmoothing: settings.gForceSmoothing,
    gForceSmoothingStrength: settings.gForceSmoothingStrength,
    brakingZoneSettings,
    enableLabs: settings.enableLabs,
    darkMode: settings.darkMode,
    gForceSource: settings.gForceSource,
  }), [useKph, settings.gForceSmoothing, settings.gForceSmoothingStrength, brakingZoneSettings, settings.enableLabs, settings.darkMode, settings.gForceSource]);

  // Memoize sliced data arrays to avoid recreating on every render
  const slicedPaceData = useMemo(
    () => paceData.slice(visibleRange[0], visibleRange[1] + 1),
    [paceData, visibleRange]
  );
  const slicedReferenceSpeedData = useMemo(
    () => referenceSpeedData.slice(visibleRange[0], visibleRange[1] + 1),
    [referenceSpeedData, visibleRange]
  );

  // ── SessionContext: everything the three main view tabs need ────────────
  // Tabs read this via `useSessionContext()` instead of receiving 25+ props.
  const sessionContextValue = useMemo<SessionContextValue>(() => ({
    data,
    visibleSamples,
    filteredSamples,
    allSamples: data?.samples ?? [],
    referenceSamples,
    currentSample,
    fieldMappings,
    currentIndex,
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
    onClearExternalRef: handleClearExternalRef,
    onLoadFileForRef: handleLoadFileForRef,
    onRefreshSavedFiles: refreshSavedFiles,
    onRangeChange: handleRangeChange,
    onFieldToggle: sessionData.handleFieldToggle,
    onWeatherStationResolved: sessionMeta.handleWeatherStationResolved,
    onSaveSessionSetup: sessionMeta.handleSaveSessionSetup,
    formatRangeLabel,
  }), [
    data, visibleSamples, filteredSamples, referenceSamples, currentSample, fieldMappings,
    currentIndex, visibleRange, minRange,
    selectedCourse, filteredBounds,
    laps, selectedLapNumber, selectedLapTimeMs, referenceLapNumber, isAllLaps,
    hasReference, paceDiff, paceDiffLabel, slicedPaceData, slicedReferenceSpeedData,
    deltaTopSpeed, deltaMinSpeed, lapToFastestDelta, refAvgTopSpeed, refAvgMinSpeed,
    externalRefLabel, savedFiles,
    sessionGpsPoint, currentFileName, sessionKartId, sessionSetupId, cachedWeatherStation,
    vehicleManager.vehicles, setupManager.setups, templateManager.templates,
    videoSync.state, videoSync.actions, videoSync.handleLoadedMetadata,
    handleScrub, handleLapSelect, handleSetReferenceWithClear,
    handleSelectExternalLapWithClear, handleClearExternalRef, handleLoadFileForRef,
    refreshSavedFiles, handleRangeChange,
    sessionData.handleFieldToggle, sessionMeta.handleWeatherStationResolved,
    sessionMeta.handleSaveSessionSetup, formatRangeLabel,
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
    vehicles: vehicleManager.vehicles,
    vehicleTypes: templateManager.vehicleTypes,
    templates: templateManager.templates,
    onAddVehicle: vehicleManager.addVehicle,
    onUpdateVehicle: vehicleManager.updateVehicle,
    onRemoveVehicle: vehicleManager.removeVehicle,
    currentFileName,
    notes: noteManager.notes,
    onAddNote: noteManager.addNote,
    onUpdateNote: noteManager.updateNote,
    onRemoveNote: noteManager.removeNote,
    setups: setupManager.setups,
    onAddSetup: setupManager.addSetup,
    onUpdateSetup: setupManager.updateSetup,
    onRemoveSetup: setupManager.removeSetup,
    onGetLatestSetupForVehicle: setupManager.getLatestForVehicle,
    onAddVehicleType: templateManager.addVehicleType,
    onRemoveVehicleType: templateManager.removeVehicleType,
    sessionKartId,
    sessionSetupId,
    onSaveSessionSetup: sessionMeta.handleSaveSessionSetup,
  }), [
    fileManager.isOpen, fileManager.files, fileManager.fileMetadataMap, fileManager.storageUsed, fileManager.storageQuota,
    fileManager.close, fileManager.loadFile, fileManager.removeFile, fileManager.exportFile, fileManager.saveFile,
    handleDataLoaded, settings.autoSaveFiles,
    vehicleManager.vehicles, vehicleManager.addVehicle, vehicleManager.updateVehicle, vehicleManager.removeVehicle,
    templateManager.vehicleTypes, templateManager.templates, templateManager.addVehicleType, templateManager.removeVehicleType,
    currentFileName,
    noteManager.notes, noteManager.addNote, noteManager.updateNote, noteManager.removeNote,
    setupManager.setups, setupManager.addSetup, setupManager.updateSetup, setupManager.removeSetup, setupManager.getLatestForVehicle,
    sessionKartId, sessionSetupId, sessionMeta.handleSaveSessionSetup,
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
            enableAdmin={enableAdmin}
          />
          <FileManagerDrawer {...fileManagerProps} />
        </>
      </DeviceProvider>
    );
  }

  
  // Data loaded - show main view
    return (
    <DeviceProvider>
    <SettingsProvider value={settingsContextValue}>
    <SessionProvider value={sessionContextValue}>
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
                <p>{isPlaying ? "Pause" : "Play"} ({averageFrameRate ? `${averageFrameRate.toFixed(0)} Hz` : "–"})</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TrackEditor selection={selection} onSelectionChange={handleSelectionChange} compact laps={laps} samples={data?.samples} />

          {laps.length > 0 && (
            <Select value={selectedLapNumber?.toString() ?? "all"} onValueChange={handleLapDropdownChange}>
              <SelectTrigger className="w-[140px] h-8 text-sm">
                <SelectValue placeholder="All Laps" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Laps</SelectItem>
                {laps.map((lap) => (
                  <SelectItem key={lap.lapNumber} value={lap.lapNumber.toString()}>
                    Lap {lap.lapNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <SettingsModal settings={settings} onSettingsChange={setSettings} onToggleFieldDefault={toggleFieldDefault} />
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={fileManager.open}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <TabBar topPanelView={topPanelView} setTopPanelView={setTopPanelView} laps={laps} showOverlays={showOverlays} onToggleOverlays={() => setShowOverlays(v => !v)} enableLabs={settings.enableLabs} />


        <div className="flex-1 min-h-0 overflow-hidden">
          {topPanelView === "raceline" && <RaceLineTab showOverlays={showOverlays} />}
          {topPanelView === "laptable" && <LapTimesTab />}
          {topPanelView === "graphview" && <GraphViewTab />}
          {topPanelView === "labs" && settings.enableLabs && (
            <LabsTab />
          )}
        </div>
      </main>
      <InstallPrompt />
      <FileManagerDrawer {...fileManagerProps} />
      <TrackPromptDialog
        open={trackPromptOpen}
        onOpenChange={setTrackPromptOpen}
        detectedTrack={detectedTrack}
        tracks={allTracks}
        onSelect={handleTrackPromptSelect}
        initialCenter={gpsCenter}
        detectionResult={detectionResult}
      />
    </div>
    </SessionProvider>
    </SettingsProvider>
    </DeviceProvider>
  );
}

/** Tab navigation bar for the main data view */
function TabBar({ topPanelView, setTopPanelView, laps, showOverlays, onToggleOverlays, enableLabs }: {
  topPanelView: TopPanelView;
  setTopPanelView: (view: TopPanelView) => void;
  laps: { lapNumber: number }[];
  showOverlays: boolean;
  onToggleOverlays: () => void;
  enableLabs: boolean;
}) {
  const tabClass = (view: TopPanelView) =>
    `flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
      topPanelView === view
        ? "text-primary border-b-2 border-primary bg-primary/5"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex items-center border-b border-border shrink-0">
      <button onClick={() => setTopPanelView("raceline")} className={tabClass("raceline")}>
        <Map className="w-4 h-4" /> Simple
      </button>
      <button onClick={() => setTopPanelView("graphview")} className={tabClass("graphview")}>
        <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">Pro</span>
      </button>
      <button onClick={() => setTopPanelView("laptable")} className={tabClass("laptable")}>
        <ListOrdered className="w-4 h-4" /> Lap Times
        {laps.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">{laps.length}</span>
        )}
      </button>
      {enableLabs && (
        <button onClick={() => setTopPanelView("labs")} className={tabClass("labs")}>
          <FlaskConical className="w-4 h-4" /> <span className="hidden sm:inline">Labs</span>
        </button>
      )}
      {topPanelView === "raceline" && (
        <div className="ml-auto mr-3">
          <Button variant="ghost" size="sm" onClick={onToggleOverlays} className="h-7 px-2 gap-1.5">
            {showOverlays ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span className="text-xs">Overlay</span>
          </Button>
        </div>
      )}
    </div>
  );
}
