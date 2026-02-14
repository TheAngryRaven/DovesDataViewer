import { useCallback, useMemo, useState } from "react";
import { Gauge, Map, ListOrdered, BarChart3, FolderOpen, Play, Pause, Loader2, Github, Eye, EyeOff, Heart, FlaskConical, BookOpen, ExternalLink, Shield, Download, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileImport } from "@/components/FileImport";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
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
import { ParsedData, Track, TrackCourseSelection } from "@/types/racing";
import { getFileMetadata } from "@/lib/fileStorage";
import { loadTracks } from "@/lib/trackStorage";
import { findNearestTrack } from "@/lib/trackUtils";
import { TrackPromptDialog } from "@/components/TrackPromptDialog";
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
import { useVideoSync } from "@/hooks/useVideoSync";
import { SettingsProvider } from "@/contexts/SettingsContext";


type TopPanelView = "raceline" | "laptable" | "graphview" | "labs";

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';

export default function Index() {
  const { settings, setSettings, toggleFieldDefault, isFieldHiddenByDefault } = useSettings();
  const fileManager = useFileManager();
  const kartManager = useKartManager();
  const setupManager = useSetupManager();
  const navigate = useNavigate();
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
  const [trackPromptOpen, setTrackPromptOpen] = useState(false);
  const [detectedTrack, setDetectedTrack] = useState<Track | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);

  // Video sync for Labs tab
  const videoSync = useVideoSync({
    samples: visibleSamples,
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
        const computedLaps = lapMgmt.calculateAndSetLaps(courseToUse, parsedData.samples);
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
          const nearest = findNearestTrack(validSample.lat, validSample.lon, tracks);
          setDetectedTrack(nearest as Track | null);
          setTrackPromptOpen(true);
        }
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
  }), [settings.brakingEntryThreshold, settings.brakingExitThreshold, settings.brakingMinDuration, settings.brakingSmoothingAlpha, settings.brakingZoneColor, settings.brakingZoneWidth, settings.brakingGraphWindow]);

  const selectedLapTimeMs = selectedLapNumber !== null
    ? (laps.find((l) => l.lapNumber === selectedLapNumber)?.lapTimeMs ?? null)
    : null;

  const minRange = Math.min(10, Math.floor(filteredSamples.length / 10));

  const settingsContextValue = useMemo(() => ({
    useKph,
    gForceSmoothing: settings.gForceSmoothing,
    gForceSmoothingStrength: settings.gForceSmoothingStrength,
    brakingZoneSettings,
    enableLabs: settings.enableLabs,
  }), [useKph, settings.gForceSmoothing, settings.gForceSmoothingStrength, brakingZoneSettings, settings.enableLabs]);

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
                <h1 className="text-xl font-semibold text-foreground">HackTheTrack.net</h1>
                <p className="text-sm text-muted-foreground">Experimental Data Viewer</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Info className="w-4 h-4" />
                    <span className="hidden sm:inline">About</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>About HackTheTrack</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 text-sm text-muted-foreground">
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Works Offline &amp; Can Be Installed</h3>
                      <p>
                        HackTheTrack is a fully offline-capable web application. Once loaded, it works without an internet connection — perfect for the track. You can <strong className="text-foreground">install it like a native app</strong> on your phone, tablet, or computer by using the "Install" option in your browser menu (or the prompt that appears at the bottom of the page).
                      </p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Your Data Stays on Your Device</h3>
                      <p>
                        All data processing happens entirely in your browser. Your log files, session notes, kart setups, and video sync data are saved locally on your device — nothing is uploaded to any server.
                      </p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Community Track Database</h3>
                      <p>
                        Don't see your track? You can define custom track and course layouts in the editor, then submit them to the site-wide database for everyone to use. Submissions are reviewed before being added.
                      </p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">Free &amp; Open Source</h3>
                      <p>
                        Every feature in HackTheTrack is completely free. The source code is open and available on GitHub. If cloud-saving is added in the future, that may carry a small cost to cover server fees — but all local features will always remain free.
                      </p>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <BookOpen className="w-4 h-4" />
                    <span className="hidden sm:inline">Credits</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Credits</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground mb-4">
                    Built on the shoulders of these incredible open-source projects and free services.
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      ["React", "https://react.dev"],
                      ["Vite", "https://vite.dev"],
                      ["TypeScript", "https://www.typescriptlang.org"],
                      ["Tailwind CSS", "https://tailwindcss.com"],
                      ["shadcn/ui", "https://ui.shadcn.com"],
                      ["Radix UI", "https://www.radix-ui.com"],
                      ["Leaflet", "https://leafletjs.com"],
                      ["OpenStreetMap", "https://www.openstreetmap.org"],
                      ["Lucide Icons", "https://lucide.dev"],
                      ["TanStack Query", "https://tanstack.com/query"],
                      ["IEM ASOS (Iowa State)", "https://mesonet.agron.iastate.edu"],
                      ["NWS API", "https://www.weather.gov/documentation/services-web-api"],
                      ["Savitzky-Golay (ml.js)", "https://github.com/mljs/savitzky-golay"],
                      ["Sonner", "https://sonner.emilkowal.dev"],
                      ["react-resizable-panels", "https://github.com/bvaughn/react-resizable-panels"],
                      ["MoTeC i2", "https://www.motec.com.au"],
                    ].map(([name, url]) => (
                      <a
                        key={name}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-accent transition-colors text-sm"
                      >
                        <span className="font-medium text-foreground">{name}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </a>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>

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
              {enableAdmin && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate('/admin')}>
                  <Shield className="w-4 h-4" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl space-y-6">
            <div className="flex justify-end items-center gap-2">
              <a href="/tracks.json" download="tracks.json">
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">tracks.json</span>
                </Button>
              </a>
              <a href="/tracks.zip" download="tracks.zip">
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">tracks.zip</span>
                </Button>
              </a>
              <LocalWeatherDialog />
            </div>

            <FileImport
              onDataLoaded={handleDataLoaded}
              onOpenFileManager={fileManager.open}
              autoSave={settings.autoSaveFiles}
              autoSaveFile={fileManager.saveFile}
            />

            <div className="text-center text-sm text-muted-foreground space-y-3">
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
                <h3 className="font-medium text-foreground mb-2">Experimental Data Viewer</h3>
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
        <TabBar topPanelView={topPanelView} setTopPanelView={setTopPanelView} laps={laps} showOverlays={showOverlays} onToggleOverlays={() => setShowOverlays(v => !v)} enableLabs={settings.enableLabs} />

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
              videoState={videoSync.state}
              videoActions={videoSync.actions}
              onVideoLoadedMetadata={videoSync.handleLoadedMetadata}
              currentSample={currentSample}
            />
          )}
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
      />
    </div>
    </SettingsProvider>
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
