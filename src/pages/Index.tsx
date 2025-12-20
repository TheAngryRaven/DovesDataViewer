import { useState, useCallback, useMemo, useEffect } from "react";
import { Gauge, Map, ListOrdered, Settings, Play, Loader2, Github } from "lucide-react";
import { FileImport } from "@/components/FileImport";
import { TrackEditor } from "@/components/TrackEditor";
import { RaceLineView } from "@/components/RaceLineView";
import { TelemetryChart } from "@/components/TelemetryChart";
import { LapTable } from "@/components/LapTable";
import { ResizableSplit } from "@/components/ResizableSplit";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ParsedData, Lap, FieldMapping, GpsSample, TrackCourseSelection, Course } from "@/types/racing";
import { calculateLaps } from "@/lib/lapCalculation";
import { parseDatalog } from "@/lib/nmeaParser";
import { calculatePace, calculateReferenceSpeed } from "@/lib/referenceUtils";
import { loadTracks } from "@/lib/trackStorage";
import { findSpeedEvents } from "@/lib/speedEvents";

type TopPanelView = "raceline" | "laptable";

export default function Index() {
  const [data, setData] = useState<ParsedData | null>(null);
  const [selection, setSelection] = useState<TrackCourseSelection | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [topPanelView, setTopPanelView] = useState<TopPanelView>("raceline");
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [selectedLapNumber, setSelectedLapNumber] = useState<number | null>(null);
  const [referenceLapNumber, setReferenceLapNumber] = useState<number | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [useKph, setUseKph] = useState(false);

  const selectedCourse: Course | null = selection?.course ?? null;

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
      setFieldMappings(parsedData.fieldMappings);
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
  }, []);

  // Filter samples to selected lap
  const filteredSamples = useMemo((): GpsSample[] => {
    if (!data) return [];
    if (selectedLapNumber === null) return data.samples;

    const lap = laps.find((l) => l.lapNumber === selectedLapNumber);
    if (!lap) return data.samples;

    return data.samples.slice(lap.startIndex, lap.endIndex + 1);
  }, [data, laps, selectedLapNumber]);

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
    
    const fastestLap = laps.reduce((min, lap) => 
      lap.lapTimeMs < min.lapTimeMs ? lap : min, laps[0]);
    
    return data.samples.slice(fastestLap.startIndex, fastestLap.endIndex + 1);
  }, [data, laps]);

  // Calculate pace and reference speed when reference is selected
  const { paceData, referenceSpeedData } = useMemo(() => {
    if (referenceSamples.length === 0 || filteredSamples.length === 0) {
      return { paceData: [], referenceSpeedData: [] };
    }
    
    return {
      paceData: calculatePace(filteredSamples, referenceSamples),
      referenceSpeedData: calculateReferenceSpeed(filteredSamples, referenceSamples, useKph)
    };
  }, [filteredSamples, referenceSamples, useKph]);

  // Calculate pace diff for display (vs reference if selected, else vs best)
  const { paceDiff, paceDiffLabel, deltaTopSpeed, deltaMinSpeed } = useMemo((): { 
    paceDiff: number | null; 
    paceDiffLabel: 'best' | 'ref';
    deltaTopSpeed: number | null;
    deltaMinSpeed: number | null;
  } => {
    if (filteredSamples.length === 0 || selectedLapNumber === null) {
      return { paceDiff: null, paceDiffLabel: 'best', deltaTopSpeed: null, deltaMinSpeed: null };
    }
    
    // Calculate speed events for current lap
    const currentEvents = findSpeedEvents(filteredSamples);
    const currentPeaks = currentEvents.filter(e => e.type === 'peak');
    const currentValleys = currentEvents.filter(e => e.type === 'valley');
    const currentAvgTop = currentPeaks.length > 0 
      ? currentPeaks.reduce((sum, e) => sum + e.speed, 0) / currentPeaks.length 
      : null;
    const currentAvgMin = currentValleys.length > 0 
      ? currentValleys.reduce((sum, e) => sum + e.speed, 0) / currentValleys.length 
      : null;
    
    // Helper to calculate deltas against comparison samples
    const calculateDeltas = (comparisonSamples: GpsSample[]) => {
      const compEvents = findSpeedEvents(comparisonSamples);
      const compPeaks = compEvents.filter(e => e.type === 'peak');
      const compValleys = compEvents.filter(e => e.type === 'valley');
      const compAvgTop = compPeaks.length > 0 
        ? compPeaks.reduce((sum, e) => sum + e.speed, 0) / compPeaks.length 
        : null;
      const compAvgMin = compValleys.length > 0 
        ? compValleys.reduce((sum, e) => sum + e.speed, 0) / compValleys.length 
        : null;
      
      return {
        deltaTop: (currentAvgTop !== null && compAvgTop !== null) ? currentAvgTop - compAvgTop : null,
        deltaMin: (currentAvgMin !== null && compAvgMin !== null) ? currentAvgMin - compAvgMin : null
      };
    };
    
    // If reference is selected, use reference pace
    if (referenceSamples.length > 0 && paceData.length > 0) {
      const lastPace = paceData.filter(p => p !== null).pop() ?? null;
      const { deltaTop, deltaMin } = calculateDeltas(referenceSamples);
      return { paceDiff: lastPace, paceDiffLabel: 'ref', deltaTopSpeed: deltaTop, deltaMinSpeed: deltaMin };
    }
    
    // Otherwise, compare to fastest lap
    if (fastestLapSamples.length > 0) {
      const bestPaceData = calculatePace(filteredSamples, fastestLapSamples);
      const lastPace = bestPaceData.filter(p => p !== null).pop() ?? null;
      const { deltaTop, deltaMin } = calculateDeltas(fastestLapSamples);
      return { paceDiff: lastPace, paceDiffLabel: 'best', deltaTopSpeed: deltaTop, deltaMinSpeed: deltaMin };
    }
    
    return { paceDiff: null, paceDiffLabel: 'best', deltaTopSpeed: null, deltaMinSpeed: null };
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

  const handleDataLoaded = useCallback(
    (parsedData: ParsedData) => {
      setData(parsedData);
      setFieldMappings(parsedData.fieldMappings);
      setCurrentIndex(0);

      // Calculate laps if course is selected
      if (selectedCourse) {
        const computedLaps = calculateLaps(parsedData.samples, selectedCourse);
        setLaps(computedLaps);
      }
    },
    [selectedCourse],
  );

  const handleSelectionChange = useCallback(
    (newSelection: TrackCourseSelection | null) => {
      setSelection(newSelection);

      // Recalculate laps
      if (newSelection?.course && data) {
        const computedLaps = calculateLaps(data.samples, newSelection.course);
        setLaps(computedLaps);
      } else {
        setLaps([]);
      }
    },
    [data],
  );

  const handleScrub = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

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

  const speedUnit = useKph ? "kph" : "mph";
  const getCurrentSpeed = (sample: GpsSample) => useKph ? sample.speedKph : sample.speedMph;

  // No data loaded - show import UI
  if (!data) {
    return (
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
            <FileImport onDataLoaded={handleDataLoaded} />

            <div className="racing-card p-4">
              <TrackEditor selection={selection} onSelectionChange={handleSelectionChange} />
            </div>

            <div className="text-center text-sm text-muted-foreground space-y-3">
              <p>Track definitions are saved in your browser.</p>

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
              <a href="https://github.com/TheAngryRaven/lap-tracker-pro" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" />
                <span className="text-sm">View on GitHub</span>
              </a>
              <a href="https://github.com/TheAngryRaven/BirdsEye" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" />
                <span className="text-sm">View Datalogger</span>
              </a>
              <a href="https://github.com/TheAngryRaven/DovesLapTimer" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Github className="w-5 h-5" />
                <span className="text-sm">View Timer Library</span>
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Data loaded - show main view
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Gauge className="w-6 h-6 text-primary" />
          <span className="font-semibold text-foreground">Dove's DataViewer</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="speed-unit" className="text-xs text-muted-foreground">MPH</Label>
            <Switch id="speed-unit" checked={useKph} onCheckedChange={setUseKph} />
            <Label htmlFor="speed-unit" className="text-xs text-muted-foreground">KPH</Label>
          </div>

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

          {filteredSamples[currentIndex] && (
            <div className="flex items-center gap-4 text-sm font-mono bg-muted/50 px-3 py-1.5 rounded">
              <span className="text-racing-telemetrySpeed">
                {getCurrentSpeed(filteredSamples[currentIndex]).toFixed(1)} {speedUnit}
              </span>
              {fieldMappings.filter((f) => f.enabled).slice(0, 2).map((field) => (
                <span key={field.name} className="text-muted-foreground">
                  {field.name}: {(filteredSamples[currentIndex].extraFields[field.name] ?? 0).toFixed(1)}
                </span>
              ))}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => setData(null)}>
            <Settings className="w-4 h-4 mr-2" />
            New File
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
                {referenceLapNumber !== null && (
                  <span className="ml-auto mr-3 px-2 py-1 text-xs font-medium bg-accent text-accent-foreground rounded">
                    Reference Lap: {referenceLapNumber}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-hidden">
                {topPanelView === "raceline" ? (
                  <RaceLineView
                    samples={filteredSamples}
                    referenceSamples={referenceSamples}
                    currentIndex={currentIndex}
                    course={selectedCourse}
                    bounds={filteredBounds!}
                    useKph={useKph}
                    paceDiff={paceDiff}
                    paceDiffLabel={paceDiffLabel}
                    deltaTopSpeed={deltaTopSpeed}
                    deltaMinSpeed={deltaMinSpeed}
                  />
                ) : (
                  <LapTable 
                    laps={laps} 
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
            <TelemetryChart
              samples={filteredSamples}
              fieldMappings={fieldMappings}
              currentIndex={currentIndex}
              onScrub={handleScrub}
              onFieldToggle={handleFieldToggle}
              useKph={useKph}
              paceData={paceData}
              referenceSpeedData={referenceSpeedData}
              hasReference={referenceLapNumber !== null}
            />
          }
        />
      </main>
    </div>
  );
}
