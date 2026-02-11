import { useCallback, useMemo } from "react";
import { Gauge, Map, ListOrdered, BarChart3, FolderOpen, Play, Pause, Loader2, Github, Eye, EyeOff, Heart } from "lucide-react";
import { FileImport } from "@/components/FileImport";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
import { TrackEditor } from "@/components/TrackEditor";
import { RaceLineTab } from "@/components/tabs/RaceLineTab";
import { LapTimesTab } from "@/components/tabs/LapTimesTab";
import { GraphViewTab } from "@/components/tabs/GraphViewTab";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SettingsModal } from "@/components/SettingsModal";
import { FileManagerDrawer } from "@/components/FileManagerDrawer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ParsedData, TrackCourseSelection } from "@/types/racing";
import { getFileMetadata } from "@/lib/fileStorage";
import { loadTracks } from "@/lib/trackStorage";
import { useSettings } from "@/hooks/useSettings";
import { usePlayback } from "@/hooks/usePlayback";
import { useFileManager } from "@/hooks/useFileManager";
import { useKartManager } from "@/hooks/useKartManager";
import { useNoteManager } from "@/hooks/useNoteManager";
import { useSetupManager } from "@/hooks/useSetupManager";
import { useSessionData } from "@/hooks/useSessionData";
import { useLapManagement } from "@/hooks/useLapManagement";
import { useReferenceLap, useExternalReference } from "@/hooks/useReferenceLap";
import { useSessionMetadata } from "@/hooks/useSessionMetadata";
import { useState } from "react";
import { SettingsProvider } from "@/contexts/SettingsContext";

type TopPanelView = "raceline" | "laptable" | "graphview";

export default function Index() {
  const { settings, setSettings, toggleFieldDefault, isFieldHiddenByDefault } = useSettings();
  const fileManager = useFileManager();
  const kartManager = useKartManager();
  const setupManager = useSetupManager();
  const useKph = settings.useKph;

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

  // Orchestrate data loading — connects sessionData, lapMgmt, and sessionMeta
  const handleDataLoaded = useCallback(
    async (parsedData: ParsedData, fileName?: string) => {
      sessionData.loadParsedData(parsedData, fileName);
      setCurrentIndex(0);

      // Try to restore track selection from metadata
      let courseToUse = selectedCourse;
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
        const computedLaps = lapMgmt.calculateAndSetLaps(courseToUse, parsedData.samples);
        if (computedLaps.length > 0) {
          const fastest = computedLaps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), computedLaps[0]);
          setSelectedLapNumber(fastest.lapNumber);
        }
      } else {
        setSelectedLapNumber(null);
      }
    },
    [selectedCourse, sessionData, lapMgmt, sessionMeta, setCurrentIndex, setSelectedLapNumber]
  );

  // Wire up sample loading
  const handleLoadSample = useCallback(() => {
    sessionData.handleLoadSample(
      handleSelectionChange,
      (computedLaps, autoSelectLap, autoSelectRef) => {
        lapMgmt.setLaps(computedLaps);
        if (autoSelectLap !== undefined) setSelectedLapNumber(autoSelectLap);
        if (autoSelectRef !== undefined) setReferenceLapNumber(autoSelectRef);
      }
    );
  }, [sessionData, handleSelectionChange, lapMgmt, setSelectedLapNumber, setReferenceLapNumber]);

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

  const brakingZoneSettings = useMemo(() => ({
    entryThresholdG: settings.brakingEntryThreshold / 100,
    exitThresholdG: settings.brakingExitThreshold / 100,
    minDurationMs: settings.brakingMinDuration,
    smoothingAlpha: settings.brakingSmoothingAlpha / 100,
    color: settings.brakingZoneColor,
    width: settings.brakingZoneWidth,
  }), [settings.brakingEntryThreshold, settings.brakingExitThreshold, settings.brakingMinDuration, settings.brakingSmoothingAlpha, settings.brakingZoneColor, settings.brakingZoneWidth]);

  const selectedLapTimeMs = selectedLapNumber !== null
    ? (laps.find((l) => l.lapNumber === selectedLapNumber)?.lapTimeMs ?? null)
    : null;

  const minRange = Math.min(10, Math.floor(filteredSamples.length / 10));

  const settingsContextValue = useMemo(() => ({
    useKph,
    gForceSmoothing: settings.gForceSmoothing,
    gForceSmoothingStrength: settings.gForceSmoothingStrength,
    brakingZoneSettings,
  }), [useKph, settings.gForceSmoothing, settings.gForceSmoothingStrength, brakingZoneSettings]);

  // Memoize sliced data arrays to avoid recreating on every render
  const slicedPaceData = useMemo(
    () => paceData.slice(visibleRange[0], visibleRange[1] + 1),
    [paceData, visibleRange]
  );
  const slicedReferenceSpeedData = useMemo(
    () => referenceSpeedData.slice(visibleRange[0], visibleRange[1] + 1),
    [referenceSpeedData, visibleRange]
  );

  // Shared FileManagerDrawer props
  const fileManagerProps = useMemo(() => ({
    isOpen: fileManager.isOpen,
    files: fileManager.files,
    storageUsed: fileManager.storageUsed,
    storageQuota: fileManager.storageQuota,
    onClose: fileManager.close,
    onLoadFile: fileManager.loadFile,
    onDeleteFile: fileManager.removeFile,
    onExportFile: fileManager.exportFile,
    onSaveFile: fileManager.saveFile,
    onDataLoaded: handleDataLoaded,
    autoSave: settings.autoSaveFiles,
    karts: kartManager.karts,
    onAddKart: kartManager.addKart,
    onUpdateKart: kartManager.updateKart,
    onRemoveKart: kartManager.removeKart,
    currentFileName,
    notes: noteManager.notes,
    onAddNote: noteManager.addNote,
    onUpdateNote: noteManager.updateNote,
    onRemoveNote: noteManager.removeNote,
    setups: setupManager.setups,
    onAddSetup: setupManager.addSetup,
    onUpdateSetup: setupManager.updateSetup,
    onRemoveSetup: setupManager.removeSetup,
    onGetLatestSetupForKart: setupManager.getLatestForKart,
    sessionKartId,
    sessionSetupId,
    onSaveSessionSetup: sessionMeta.handleSaveSessionSetup,
  }), [
    fileManager.isOpen, fileManager.files, fileManager.storageUsed, fileManager.storageQuota,
    fileManager.close, fileManager.loadFile, fileManager.removeFile, fileManager.exportFile, fileManager.saveFile,
    handleDataLoaded, settings.autoSaveFiles,
    kartManager.karts, kartManager.addKart, kartManager.updateKart, kartManager.removeKart,
    currentFileName,
    noteManager.notes, noteManager.addNote, noteManager.updateNote, noteManager.removeNote,
    setupManager.setups, setupManager.addSetup, setupManager.updateSetup, setupManager.removeSetup, setupManager.getLatestForKart,
    sessionKartId, sessionSetupId, sessionMeta.handleSaveSessionSetup,
  ]);

  // No data loaded - show import UI
  if (!data) {
    return (
      <>
        <InstallPrompt />
        <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Gauge className="w-8 h-8 text-primary" />
              <div>
                <h1 className="text-xl font-semibold text-foreground">Dove's DataViewer</h1>
                <p className="text-sm text-muted-foreground">NMEA Enhanced Format</p>
              </div>
            </div>
            <a
              href="https://github.com/sponsors/TheAngryRaven"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-2">
                <Heart className="w-4 h-4 text-pink-500" />
                <span className="hidden sm:inline">Sponsor</span>
              </Button>
            </a>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-6">
            <div className="flex justify-end">
              <LocalWeatherDialog />
            </div>

            <FileImport
              onDataLoaded={handleDataLoaded}
              onOpenFileManager={fileManager.open}
              autoSave={settings.autoSaveFiles}
              autoSaveFile={fileManager.saveFile}
            />

            <div className="racing-card p-4">
              <TrackEditor selection={selection} onSelectionChange={handleSelectionChange} />
            </div>

            <div className="text-center text-sm text-muted-foreground space-y-3">
              <p>Track definitions are saved in your browser.</p>
              <p> </p>

              <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
                <h3 className="font-medium text-foreground mb-2">Try it out!</h3>
                <p className="text-xs mb-3">Load sample data from Orlando Kart Center to see how the viewer works.</p>
                <Button variant="default" size="sm" onClick={handleLoadSample} disabled={isLoadingSample}>
                  {isLoadingSample ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {isLoadingSample ? "Loading..." : "Load Sample Data"}
                </Button>
              </div>

              <div className="mt-4 p-4 bg-muted/30 rounded-lg text-left border border-border/50">
                <h3 className="font-medium text-foreground mb-2">NMEA Enhanced Format</h3>
                <p className="text-xs leading-relaxed">
                  This viewer supports <span className="font-medium text-foreground">NMEA Enhanced</span> format —
                  standard NMEA sentences (RMC, GGA) organized as tab-delimited CSV with optional additional data
                  columns.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-center gap-8 mt-4">
              <a href="https://github.com/TheAngryRaven/DovesDataViewer" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" /><span className="text-sm">View on GitHub</span>
              </a>
              <a href="https://github.com/TheAngryRaven/DovesDataLogger" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" /><span className="text-sm">View Datalogger</span>
              </a>
              <a href="https://github.com/TheAngryRaven/DovesLapTimer" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" /><span className="text-sm">View Timer Library</span>
              </a>
            </div>
          </div>
        </main>
      </div>
      <FileManagerDrawer {...fileManagerProps} />
      </>
    );
  }

  // Data loaded - show main view
  return (
    <SettingsProvider value={settingsContextValue}>
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Gauge className="w-6 h-6 text-primary" />
          <span className="font-semibold text-foreground hidden sm:inline">Dove's DataViewer</span>
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

          <TrackEditor selection={selection} onSelectionChange={handleSelectionChange} compact />

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
        <TabBar topPanelView={topPanelView} setTopPanelView={setTopPanelView} laps={laps} showOverlays={showOverlays} onToggleOverlays={() => setShowOverlays(v => !v)} />

        <div className="flex-1 min-h-0 overflow-hidden">
          {topPanelView === "raceline" && (
            <RaceLineTab
              visibleSamples={visibleSamples}
              filteredSamples={filteredSamples}
              referenceSamples={referenceSamples}
              currentIndex={currentIndex}
              course={selectedCourse}
              bounds={filteredBounds!}
              paceDiff={paceDiff}
              paceDiffLabel={paceDiffLabel}
              deltaTopSpeed={deltaTopSpeed}
              deltaMinSpeed={deltaMinSpeed}
              referenceLapNumber={referenceLapNumber}
              lapToFastestDelta={lapToFastestDelta}
              showOverlays={showOverlays}
              lapTimeMs={selectedLapTimeMs}
              refAvgTopSpeed={refAvgTopSpeed}
              refAvgMinSpeed={refAvgMinSpeed}
              sessionGpsPoint={sessionGpsPoint}
              sessionStartDate={data?.startDate}
              cachedWeatherStation={cachedWeatherStation}
              onWeatherStationResolved={sessionMeta.handleWeatherStationResolved}
              fieldMappings={fieldMappings}
              onScrub={handleScrub}
              onFieldToggle={sessionData.handleFieldToggle}
              paceData={slicedPaceData}
              referenceSpeedData={slicedReferenceSpeedData}
              hasReference={hasReference}
              visibleRange={visibleRange}
              onRangeChange={handleRangeChange}
              minRange={minRange}
              formatRangeLabel={formatRangeLabel}
            />
          )}
          {topPanelView === "laptable" && (
            <LapTimesTab
              laps={laps}
              course={selectedCourse}
              onLapSelect={handleLapSelect}
              selectedLapNumber={selectedLapNumber}
              referenceLapNumber={referenceLapNumber}
              onSetReference={handleSetReferenceWithClear}
              externalRefLabel={externalRefLabel}
              savedFiles={savedFiles}
              onLoadFileForRef={handleLoadFileForRef}
              onSelectExternalLap={handleSelectExternalLapWithClear}
              onClearExternalRef={handleClearExternalRef}
              onRefreshSavedFiles={refreshSavedFiles}
            />
          )}
          {topPanelView === "graphview" && (
            <GraphViewTab
              visibleSamples={visibleSamples}
              filteredSamples={filteredSamples}
              referenceSamples={referenceSamples}
              currentIndex={currentIndex}
              onScrub={handleScrub}
              fieldMappings={fieldMappings}
              course={selectedCourse}
              lapTimeMs={selectedLapTimeMs}
              paceDiff={paceDiff}
              paceDiffLabel={paceDiffLabel}
              deltaTopSpeed={deltaTopSpeed}
              deltaMinSpeed={deltaMinSpeed}
              referenceLapNumber={referenceLapNumber}
              lapToFastestDelta={lapToFastestDelta}
              bounds={filteredBounds!}
              sessionGpsPoint={sessionGpsPoint}
              sessionStartDate={data?.startDate}
              cachedWeatherStation={cachedWeatherStation}
              onWeatherStationResolved={sessionMeta.handleWeatherStationResolved}
              karts={kartManager.karts}
              setups={setupManager.setups}
              sessionKartId={sessionKartId}
              sessionSetupId={sessionSetupId}
              onSaveSessionSetup={sessionMeta.handleSaveSessionSetup}
              visibleRange={visibleRange}
              onRangeChange={handleRangeChange}
              minRange={minRange}
              formatRangeLabel={formatRangeLabel}
            />
          )}
        </div>
      </main>
      <InstallPrompt />
      <FileManagerDrawer {...fileManagerProps} />
    </div>
    </SettingsProvider>
  );
}

/** Tab navigation bar for the main data view */
function TabBar({ topPanelView, setTopPanelView, laps, showOverlays, onToggleOverlays }: {
  topPanelView: TopPanelView;
  setTopPanelView: (view: TopPanelView) => void;
  laps: { lapNumber: number }[];
  showOverlays: boolean;
  onToggleOverlays: () => void;
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
        <Map className="w-4 h-4" /> Race Line
      </button>
      <button onClick={() => setTopPanelView("laptable")} className={tabClass("laptable")}>
        <ListOrdered className="w-4 h-4" /> Lap Times
        {laps.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">{laps.length}</span>
        )}
      </button>
      <button onClick={() => setTopPanelView("graphview")} className={tabClass("graphview")}>
        <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">Graph View</span>
      </button>
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
