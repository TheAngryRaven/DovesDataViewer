import { useState, useCallback, useMemo, useEffect } from "react";
import { Gauge, Map, ListOrdered, FolderOpen, Play, Pause, Loader2, Github, Eye, EyeOff } from "lucide-react";
import { FileImport } from "@/components/FileImport";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
import { TrackEditor } from "@/components/TrackEditor";
import { RaceLineView } from "@/components/RaceLineView";
import { TelemetryChart } from "@/components/TelemetryChart";
import { LapTable } from "@/components/LapTable";
// LapSummaryWidget removed - replaced by overlay toggle
import { ResizableSplit } from "@/components/ResizableSplit";
import { RangeSlider } from "@/components/RangeSlider";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SettingsModal } from "@/components/SettingsModal";
import { FileManagerDrawer } from "@/components/FileManagerDrawer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ParsedData, Lap, FieldMapping, GpsSample, TrackCourseSelection, Course } from "@/types/racing";
import { saveFileMetadata, getFileMetadata } from "@/lib/fileStorage";
import { WeatherStation } from "@/lib/weatherService";
import { calculateLaps } from "@/lib/lapCalculation";
import { parseDatalog } from "@/lib/nmeaParser";
import { calculatePace, calculateReferenceSpeed } from "@/lib/referenceUtils";
import { loadTracks } from "@/lib/trackStorage";
import { findSpeedEvents } from "@/lib/speedEvents";
import { useSettings } from "@/hooks/useSettings";
import { usePlayback } from "@/hooks/usePlayback";
import { useFileManager } from "@/hooks/useFileManager";
import { useKartManager } from "@/hooks/useKartManager";
import { useNoteManager } from "@/hooks/useNoteManager";

type TopPanelView = "raceline" | "laptable";

export default function Index() {
  const { settings, setSettings, toggleFieldDefault, isFieldHiddenByDefault } = useSettings();
  const fileManager = useFileManager();
  const kartManager = useKartManager();
  const useKph = settings.useKph;
  
  const [data, setData] = useState<ParsedData | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const noteManager = useNoteManager(currentFileName);
  const [selection, setSelection] = useState<TrackCourseSelection | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [topPanelView, setTopPanelView] = useState<TopPanelView>("raceline");
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [selectedLapNumber, setSelectedLapNumber] = useState<number | null>(null);
  const [referenceLapNumber, setReferenceLapNumber] = useState<number | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  // Range selection state (indices within filteredSamples)
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 0]);
  const [showOverlays, setShowOverlays] = useState(true);
  const [cachedWeatherStation, setCachedWeatherStation] = useState<WeatherStation | null>(null);

  const selectedCourse: Course | null = selection?.course ?? null;

  // Playback hook - needs to be after visibleSamples is defined, but we use a forward reference pattern
  // We'll initialize it after visibleSamples is computed

  const handleLoadSample = useCallback(async () => {
    setIsLoadingSample(true);
    try {
      const tracks = await loadTracks();
      const okcTrack = tracks.find((t) => t.name === "Orlando Kart Center");
      const okcCourse = okcTrack?.courses[0] ?? null;

      const response = await fetch("/samples/okc-tillotson-plain.nmea");
      const text = await response.text();
      const parsedData = parseDatalog(text);
      setData(parsedData);
      // Apply default hidden fields from settings
      setFieldMappings(
        parsedData.fieldMappings.map((f) => ({
          ...f,
          enabled: f.enabled && !isFieldHiddenByDefault(f.name),
        }))
      );
      setCurrentIndex(0);

      if (okcTrack && okcCourse) {
        setSelection({
          trackName: okcTrack.name,
          courseName: okcCourse.name,
          course: okcCourse,
        });
        const computedLaps = calculateLaps(parsedData.samples, okcCourse);
        setLaps(computedLaps);

        // Auto-select lap 5 and reference lap 8 to showcase delta features
        if (computedLaps.length >= 5) {
          setSelectedLapNumber(5);
        }
        if (computedLaps.length >= 8) {
          setReferenceLapNumber(8);
        }
      }
    } catch (e) {
      console.error("Failed to load sample data:", e);
    } finally {
      setIsLoadingSample(false);
    }
  }, [isFieldHiddenByDefault]);

  // Filter samples to selected lap
  const filteredSamples = useMemo((): GpsSample[] => {
    if (!data) return [];
    if (selectedLapNumber === null) return data.samples;

    const lap = laps.find((l) => l.lapNumber === selectedLapNumber);
    if (!lap) return data.samples;

    return data.samples.slice(lap.startIndex, lap.endIndex + 1);
  }, [data, laps, selectedLapNumber]);

  // Reset visible range when filtered samples change
  useEffect(() => {
    if (filteredSamples.length > 0) {
      setVisibleRange([0, filteredSamples.length - 1]);
    }
  }, [filteredSamples.length, selectedLapNumber]);

  // Sync field visibility when settings change (real-time toggle)
  useEffect(() => {
    if (fieldMappings.length === 0) return;
    
    setFieldMappings((prev) =>
      prev.map((f) => ({
        ...f,
        enabled: !isFieldHiddenByDefault(f.name),
      }))
    );
  }, [settings.defaultHiddenFields, isFieldHiddenByDefault]);

  // Visible samples based on range selection
  const visibleSamples = useMemo((): GpsSample[] => {
    if (filteredSamples.length === 0) return [];
    const [start, end] = visibleRange;
    return filteredSamples.slice(start, end + 1);
  }, [filteredSamples, visibleRange]);

  // Playback hook for animating through data at realistic speed
  const { isPlaying, toggle: togglePlayback, averageFrameRate } = usePlayback({
    samples: visibleSamples,
    currentIndex,
    onIndexChange: setCurrentIndex,
    visibleRange,
  });

  // Get reference lap samples
  const referenceSamples = useMemo((): GpsSample[] => {
    if (!data || referenceLapNumber === null) return [];

    const refLap = laps.find((l) => l.lapNumber === referenceLapNumber);
    if (!refLap) return [];

    return data.samples.slice(refLap.startIndex, refLap.endIndex + 1);
  }, [data, laps, referenceLapNumber]);

  // Get fastest lap samples for pace comparison when no reference selected
  const fastestLapSamples = useMemo((): GpsSample[] => {
    if (!data || laps.length === 0) return [];

    const fastestLap = laps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), laps[0]);

    return data.samples.slice(fastestLap.startIndex, fastestLap.endIndex + 1);
  }, [data, laps]);

  // Calculate pace and reference speed when reference is selected
  const { paceData, referenceSpeedData } = useMemo(() => {
    if (referenceSamples.length === 0 || filteredSamples.length === 0) {
      return { paceData: [], referenceSpeedData: [] };
    }

    return {
      paceData: calculatePace(filteredSamples, referenceSamples),
      referenceSpeedData: calculateReferenceSpeed(filteredSamples, referenceSamples, useKph),
    };
  }, [filteredSamples, referenceSamples, useKph]);

  // Calculate lap to fastest delta (direct lap time difference)
  const lapToFastestDelta = useMemo((): number | null => {
    if (selectedLapNumber === null || laps.length === 0) return null;

    const selectedLap = laps.find((l) => l.lapNumber === selectedLapNumber);
    if (!selectedLap) return null;

    const fastestLap = laps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), laps[0]);

    return selectedLap.lapTimeMs - fastestLap.lapTimeMs;
  }, [laps, selectedLapNumber]);

  // Calculate pace diff for display (vs reference if selected, else vs best)
  const { paceDiff, paceDiffLabel, deltaTopSpeed, deltaMinSpeed, refAvgTopSpeed, refAvgMinSpeed } = useMemo((): {
    paceDiff: number | null;
    paceDiffLabel: "best" | "ref";
    deltaTopSpeed: number | null;
    deltaMinSpeed: number | null;
    refAvgTopSpeed: number | null;
    refAvgMinSpeed: number | null;
  } => {
    if (filteredSamples.length === 0 || selectedLapNumber === null) {
      return { paceDiff: null, paceDiffLabel: "best", deltaTopSpeed: null, deltaMinSpeed: null, refAvgTopSpeed: null, refAvgMinSpeed: null };
    }

    // Calculate speed events for current lap
    const currentEvents = findSpeedEvents(filteredSamples);
    const currentPeaks = currentEvents.filter((e) => e.type === "peak");
    const currentValleys = currentEvents.filter((e) => e.type === "valley");
    const currentAvgTop =
      currentPeaks.length > 0 ? currentPeaks.reduce((sum, e) => sum + e.speed, 0) / currentPeaks.length : null;
    const currentAvgMin =
      currentValleys.length > 0 ? currentValleys.reduce((sum, e) => sum + e.speed, 0) / currentValleys.length : null;

    // Helper to calculate deltas and reference averages against comparison samples
    const calculateDeltas = (comparisonSamples: GpsSample[]) => {
      const compEvents = findSpeedEvents(comparisonSamples);
      const compPeaks = compEvents.filter((e) => e.type === "peak");
      const compValleys = compEvents.filter((e) => e.type === "valley");
      const compAvgTop =
        compPeaks.length > 0 ? compPeaks.reduce((sum, e) => sum + e.speed, 0) / compPeaks.length : null;
      const compAvgMin =
        compValleys.length > 0 ? compValleys.reduce((sum, e) => sum + e.speed, 0) / compValleys.length : null;

      return {
        deltaTop: currentAvgTop !== null && compAvgTop !== null ? currentAvgTop - compAvgTop : null,
        deltaMin: currentAvgMin !== null && compAvgMin !== null ? currentAvgMin - compAvgMin : null,
        refTop: compAvgTop,
        refMin: compAvgMin,
      };
    };

    // If reference is selected, use reference pace
    if (referenceSamples.length > 0 && paceData.length > 0) {
      const lastPace = paceData.filter((p) => p !== null).pop() ?? null;
      const { deltaTop, deltaMin, refTop, refMin } = calculateDeltas(referenceSamples);
      return { paceDiff: lastPace, paceDiffLabel: "ref", deltaTopSpeed: deltaTop, deltaMinSpeed: deltaMin, refAvgTopSpeed: refTop, refAvgMinSpeed: refMin };
    }

    // Otherwise, compare to fastest lap
    if (fastestLapSamples.length > 0) {
      const bestPaceData = calculatePace(filteredSamples, fastestLapSamples);
      const lastPace = bestPaceData.filter((p) => p !== null).pop() ?? null;
      const { deltaTop, deltaMin, refTop, refMin } = calculateDeltas(fastestLapSamples);
      return { paceDiff: lastPace, paceDiffLabel: "best", deltaTopSpeed: deltaTop, deltaMinSpeed: deltaMin, refAvgTopSpeed: refTop, refAvgMinSpeed: refMin };
    }

    return { paceDiff: null, paceDiffLabel: "best", deltaTopSpeed: null, deltaMinSpeed: null, refAvgTopSpeed: null, refAvgMinSpeed: null };
  }, [filteredSamples, referenceSamples, fastestLapSamples, paceData, selectedLapNumber]);

  // Compute bounds for filtered samples
  const filteredBounds = useMemo(() => {
    if (filteredSamples.length === 0) return data?.bounds;

    let minLat = Infinity,
      maxLat = -Infinity;
    let minLon = Infinity,
      maxLon = -Infinity;

    for (const s of filteredSamples) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lon < minLon) minLon = s.lon;
      if (s.lon > maxLon) maxLon = s.lon;
    }

    return { minLat, maxLat, minLon, maxLon };
  }, [filteredSamples, data?.bounds]);

  // Find first valid GPS sample for weather lookup
  const sessionGpsPoint = useMemo(() => {
    if (!data?.samples?.length) return undefined;
    const validSample = data.samples.find(s => 
      s.lat !== 0 && s.lon !== 0 && 
      Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
    );
    return validSample ? { lat: validSample.lat, lon: validSample.lon } : undefined;
  }, [data?.samples]);

  const handleDataLoaded = useCallback(
    async (parsedData: ParsedData, fileName?: string) => {
      setData(parsedData);
      if (fileName) setCurrentFileName(fileName);
      // Apply default hidden fields from settings
      setFieldMappings(
        parsedData.fieldMappings.map((f) => ({
          ...f,
          enabled: f.enabled && !isFieldHiddenByDefault(f.name),
        }))
      );
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
            setSelection(restoredSelection);
            courseToUse = course;
          }
          // Restore cached weather station
          if (meta.weatherStationId) {
            setCachedWeatherStation({
              stationId: meta.weatherStationId,
              name: meta.weatherStationName || meta.weatherStationId,
              distanceKm: meta.weatherStationDistanceKm || 0,
            });
          } else {
            setCachedWeatherStation(null);
          }
        } else {
          setCachedWeatherStation(null);
        }
      } else {
        setCachedWeatherStation(null);
      }

      // Calculate laps if course is selected
      if (courseToUse) {
        const computedLaps = calculateLaps(parsedData.samples, courseToUse);
        setLaps(computedLaps);
        // Auto-select fastest lap
        if (computedLaps.length > 0) {
          const fastest = computedLaps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), computedLaps[0]);
          setSelectedLapNumber(fastest.lapNumber);
        }
      } else {
        setSelectedLapNumber(null);
      }
    },
    [selectedCourse, isFieldHiddenByDefault],
  );

  const handleSelectionChange = useCallback(
    (newSelection: TrackCourseSelection | null) => {
      setSelection(newSelection);

      // Persist track/course association for current file
      if (currentFileName && newSelection) {
        // Preserve existing weather station cache when saving track selection
        getFileMetadata(currentFileName).then((existing) => {
          saveFileMetadata({
            fileName: currentFileName,
            trackName: newSelection.trackName,
            courseName: newSelection.courseName,
            weatherStationId: existing?.weatherStationId,
            weatherStationName: existing?.weatherStationName,
            weatherStationDistanceKm: existing?.weatherStationDistanceKm,
          });
        });
      }

      // Recalculate laps
      if (newSelection?.course && data) {
        const computedLaps = calculateLaps(data.samples, newSelection.course);
        setLaps(computedLaps);
        // Auto-select fastest lap
        if (computedLaps.length > 0) {
          const fastest = computedLaps.reduce((min, lap) => (lap.lapTimeMs < min.lapTimeMs ? lap : min), computedLaps[0]);
          setSelectedLapNumber(fastest.lapNumber);
        }
      } else {
        setLaps([]);
        setSelectedLapNumber(null);
      }
    },
    [data, currentFileName],
  );

  const handleScrub = useCallback(
    (index: number) => {
      // Clamp to visible range
      const clampedIndex = Math.max(0, Math.min(index, visibleRange[1] - visibleRange[0]));
      setCurrentIndex(clampedIndex);
    },
    [visibleRange],
  );

  const handleRangeChange = useCallback(
    (newRange: [number, number]) => {
      setVisibleRange(newRange);
      // Clamp current index to new visible range
      const visibleLength = newRange[1] - newRange[0];
      if (currentIndex > visibleLength) {
        setCurrentIndex(visibleLength);
      }
    },
    [currentIndex],
  );

  const handleFieldToggle = useCallback((fieldName: string) => {
    setFieldMappings((prev) => prev.map((f) => (f.name === fieldName ? { ...f, enabled: !f.enabled } : f)));
  }, []);

  const handleLapSelect = useCallback((lap: Lap) => {
    setSelectedLapNumber(lap.lapNumber);
    setCurrentIndex(0);
    setTopPanelView("raceline");
  }, []);

  const handleLapDropdownChange = useCallback((value: string) => {
    if (value === "all") {
      setSelectedLapNumber(null);
      setCurrentIndex(0);
    } else {
      const lapNum = parseInt(value, 10);
      setSelectedLapNumber(lapNum);
      setCurrentIndex(0);
    }
  }, []);

  const handleSetReference = useCallback((lapNumber: number) => {
    setReferenceLapNumber((prev) => (prev === lapNumber ? null : lapNumber));
  }, []);

  const handleWeatherStationResolved = useCallback(
    (station: WeatherStation) => {
      setCachedWeatherStation(station);
      if (currentFileName) {
        getFileMetadata(currentFileName).then((existing) => {
          saveFileMetadata({
            fileName: currentFileName,
            trackName: existing?.trackName || "",
            courseName: existing?.courseName || "",
            weatherStationId: station.stationId,
            weatherStationName: station.name,
            weatherStationDistanceKm: station.distanceKm,
          });
        });
      }
    },
    [currentFileName],
  );

  const speedUnit = useKph ? "kph" : "mph";
  const getCurrentSpeed = (sample: GpsSample) => (useKph ? sample.speedKph : sample.speedMph);

  // No data loaded - show import UI
  if (!data) {
    return (
      <>
        <InstallPrompt />
        <div className="min-h-screen bg-background flex flex-col">
        <header className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Dove's DataViewer</h1>
              <p className="text-sm text-muted-foreground">NMEA Enhanced Format</p>
            </div>
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
              <a
                href="https://github.com/TheAngryRaven/DovesDataViewer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="w-5 h-5" />
                <span className="text-sm">View on GitHub</span>
              </a>
              <a
                href="https://github.com/TheAngryRaven/DovesDataLogger"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="w-5 h-5" />
                <span className="text-sm">View Datalogger</span>
              </a>
              <a
                href="https://github.com/TheAngryRaven/DovesLapTimer"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="w-5 h-5" />
                <span className="text-sm">View Timer Library</span>
              </a>
            </div>
          </div>
        </main>
      </div>
      <FileManagerDrawer
        isOpen={fileManager.isOpen}
        files={fileManager.files}
        storageUsed={fileManager.storageUsed}
        storageQuota={fileManager.storageQuota}
        onClose={fileManager.close}
        onLoadFile={fileManager.loadFile}
        onDeleteFile={fileManager.removeFile}
        onExportFile={fileManager.exportFile}
        onSaveFile={fileManager.saveFile}
        onDataLoaded={handleDataLoaded}
        autoSave={settings.autoSaveFiles}
        karts={kartManager.karts}
        onAddKart={kartManager.addKart}
        onUpdateKart={kartManager.updateKart}
        onRemoveKart={kartManager.removeKart}
        currentFileName={currentFileName}
        notes={noteManager.notes}
        onAddNote={noteManager.addNote}
        onUpdateNote={noteManager.updateNote}
        onRemoveNote={noteManager.removeNote}
      />
      </>
    );
  }

  // Data loaded - show main view
  return (
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
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8" 
                  onClick={togglePlayback}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
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

          <SettingsModal
            settings={settings}
            onSettingsChange={setSettings}
            onToggleFieldDefault={toggleFieldDefault}
          />

          <Button variant="outline" size="icon" className="h-8 w-8" onClick={fileManager.open}>
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        <ResizableSplit
          defaultRatio={0.7}
          topPanel={
            <div className="h-full flex flex-col">
              <div className="flex items-center border-b border-border shrink-0">
                <button
                  onClick={() => setTopPanelView("raceline")}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${topPanelView === "raceline" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Map className="w-4 h-4" />
                  Race Line
                </button>
                <button
                  onClick={() => setTopPanelView("laptable")}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${topPanelView === "laptable" ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <ListOrdered className="w-4 h-4" />
                  Lap Times
                  {laps.length > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/20 text-primary rounded">{laps.length}</span>
                  )}
                </button>

                {/* Overlay toggle button */}
                <div className="ml-auto mr-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowOverlays(!showOverlays)}
                    className="h-7 px-2 gap-1.5"
                  >
                    {showOverlays ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    <span className="text-xs">Overlay</span>
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                {topPanelView === "raceline" ? (
                  <RaceLineView
                    samples={visibleSamples}
                    allSamples={filteredSamples}
                    referenceSamples={referenceSamples}
                    currentIndex={currentIndex}
                    course={selectedCourse}
                    bounds={filteredBounds!}
                    useKph={useKph}
                    paceDiff={paceDiff}
                    paceDiffLabel={paceDiffLabel}
                    deltaTopSpeed={deltaTopSpeed}
                    deltaMinSpeed={deltaMinSpeed}
                    referenceLapNumber={referenceLapNumber}
                    lapToFastestDelta={lapToFastestDelta}
                    showOverlays={showOverlays}
                    lapTimeMs={selectedLapNumber !== null ? (laps.find((l) => l.lapNumber === selectedLapNumber)?.lapTimeMs ?? null) : null}
                    refAvgTopSpeed={refAvgTopSpeed}
                    refAvgMinSpeed={refAvgMinSpeed}
                    brakingZoneSettings={{
                      entryThresholdG: settings.brakingEntryThreshold / 100,
                      exitThresholdG: settings.brakingExitThreshold / 100,
                      minDurationMs: settings.brakingMinDuration,
                      smoothingAlpha: settings.brakingSmoothingAlpha / 100,
                      color: settings.brakingZoneColor,
                      width: settings.brakingZoneWidth,
                    }}
                    sessionGpsPoint={sessionGpsPoint}
                    sessionStartDate={data?.startDate}
                    cachedWeatherStation={cachedWeatherStation}
                    onWeatherStationResolved={handleWeatherStationResolved}
                  />
                ) : (
                  <LapTable
                    laps={laps}
                    course={selectedCourse}
                    onLapSelect={handleLapSelect}
                    selectedLapNumber={selectedLapNumber}
                    referenceLapNumber={referenceLapNumber}
                    onSetReference={handleSetReference}
                    useKph={useKph}
                  />
                )}
              </div>
            </div>
          }
          bottomPanel={
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0">
                <TelemetryChart
                  samples={visibleSamples}
                  fieldMappings={fieldMappings}
                  currentIndex={currentIndex}
                  onScrub={handleScrub}
                  onFieldToggle={handleFieldToggle}
                  useKph={useKph}
                  paceData={paceData.slice(visibleRange[0], visibleRange[1] + 1)}
                  referenceSpeedData={referenceSpeedData.slice(visibleRange[0], visibleRange[1] + 1)}
                  hasReference={referenceLapNumber !== null}
                  gForceSmoothing={settings.gForceSmoothing}
                  gForceSmoothingStrength={settings.gForceSmoothingStrength}
                />
              </div>
              {filteredSamples.length > 0 && (
                <div className="shrink-0 px-4 py-2 border-t border-border bg-muted/30">
                  <RangeSlider
                    min={0}
                    max={filteredSamples.length - 1}
                    value={visibleRange}
                    onChange={handleRangeChange}
                    minRange={Math.min(10, Math.floor(filteredSamples.length / 10))}
                    formatLabel={(idx) => {
                      const sample = filteredSamples[idx];
                      if (!sample) return "";
                      const totalMs = sample.t - filteredSamples[0].t;
                      const secs = Math.floor(totalMs / 1000);
                      const mins = Math.floor(secs / 60);
                      const remSecs = secs % 60;
                      return `${mins}:${remSecs.toString().padStart(2, "0")}`;
                    }}
                  />
                </div>
              )}
            </div>
          }
        />
      </main>
      <InstallPrompt />
      <FileManagerDrawer
        isOpen={fileManager.isOpen}
        files={fileManager.files}
        storageUsed={fileManager.storageUsed}
        storageQuota={fileManager.storageQuota}
        onClose={fileManager.close}
        onLoadFile={fileManager.loadFile}
        onDeleteFile={fileManager.removeFile}
        onExportFile={fileManager.exportFile}
        onSaveFile={fileManager.saveFile}
        onDataLoaded={handleDataLoaded}
        autoSave={settings.autoSaveFiles}
        karts={kartManager.karts}
        onAddKart={kartManager.addKart}
        onUpdateKart={kartManager.updateKart}
        onRemoveKart={kartManager.removeKart}
        currentFileName={currentFileName}
        notes={noteManager.notes}
        onAddNote={noteManager.addNote}
        onUpdateNote={noteManager.updateNote}
        onRemoveNote={noteManager.removeNote}
      />
    </div>
  );
}
