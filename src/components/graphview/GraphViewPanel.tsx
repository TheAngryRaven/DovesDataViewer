import { useState, useRef } from 'react';
import { GpsSample, Course, FieldMapping } from '@/types/racing';
import { Kart } from '@/lib/kartStorage';
import { KartSetup } from '@/lib/setupStorage';
import { WeatherStation } from '@/lib/weatherService';
import { InfoBox } from './InfoBox';
import { MiniMap, BrakingZoneSettings } from './MiniMap';
import { GraphPanel } from './GraphPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Map as MapIcon, EyeOff } from 'lucide-react';
import { ImperativePanelHandle } from 'react-resizable-panels';

export interface GraphViewPanelProps {
  // Data
  visibleSamples: GpsSample[];
  filteredSamples: GpsSample[];
  currentIndex: number;
  onScrub: (index: number) => void;
  useKph: boolean;
  fieldMappings: FieldMapping[];
  // Stats
  course: Course | null;
  lapTimeMs: number | null;
  paceDiff: number | null;
  paceDiffLabel: 'best' | 'ref';
  deltaTopSpeed: number | null;
  deltaMinSpeed: number | null;
  referenceLapNumber: number | null;
  lapToFastestDelta: number | null;
  // Map
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  brakingZoneSettings: BrakingZoneSettings;
  // Weather
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  cachedWeatherStation: WeatherStation | null;
  onWeatherStationResolved: (station: WeatherStation) => void;
  // Kart/setup
  karts: Kart[];
  setups: KartSetup[];
  sessionKartId: string | null;
  sessionSetupId: string | null;
  onSaveSessionSetup: (kartId: string | null, setupId: string | null) => Promise<void>;
  onOpenSetupEditor?: (setupId: string) => void;
  // Range slider
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  minRange: number;
  formatRangeLabel: (idx: number) => string;
  // G-force settings
  gForceSmoothing: boolean;
  gForceSmoothingStrength: number;
}

export function GraphViewPanel(props: GraphViewPanelProps) {
  const [mapVisible, setMapVisible] = useState(true);
  const mapPanelRef = useRef<ImperativePanelHandle>(null);
  const savedSizeRef = useRef(30);

  const toggleMap = () => {
    const panel = mapPanelRef.current;
    if (!panel) return;
    if (mapVisible) {
      savedSizeRef.current = panel.getSize();
      panel.collapse();
      setMapVisible(false);
    } else {
      panel.expand();
      panel.resize(savedSizeRef.current);
      setMapVisible(true);
    }
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left sidebar - 30% */}
      <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
        <div className="h-full relative">
          <ResizablePanelGroup direction="vertical" className="h-full">
            {/* Info box */}
            <ResizablePanel defaultSize={70} minSize={30}>
              <InfoBox
                filteredSamples={props.filteredSamples}
                course={props.course}
                useKph={props.useKph}
                lapTimeMs={props.lapTimeMs}
                paceDiff={props.paceDiff}
                paceDiffLabel={props.paceDiffLabel}
                deltaTopSpeed={props.deltaTopSpeed}
                deltaMinSpeed={props.deltaMinSpeed}
                referenceLapNumber={props.referenceLapNumber}
                lapToFastestDelta={props.lapToFastestDelta}
                sessionGpsPoint={props.sessionGpsPoint}
                sessionStartDate={props.sessionStartDate}
                cachedWeatherStation={props.cachedWeatherStation}
                onWeatherStationResolved={props.onWeatherStationResolved}
                karts={props.karts}
                setups={props.setups}
                sessionKartId={props.sessionKartId}
                sessionSetupId={props.sessionSetupId}
                onSaveSessionSetup={props.onSaveSessionSetup}
                onOpenSetupEditor={props.onOpenSetupEditor}
              />
            </ResizablePanel>

            <ResizableHandle />

            {/* Map panel - collapsible */}
            <ResizablePanel
              ref={mapPanelRef}
              defaultSize={30}
              minSize={15}
              collapsible
              collapsedSize={0}
              onCollapse={() => setMapVisible(false)}
              onExpand={() => setMapVisible(true)}
            >
              <MiniMap
                samples={props.visibleSamples}
                allSamples={props.filteredSamples}
                currentIndex={props.currentIndex}
                course={props.course}
                bounds={props.bounds}
                useKph={props.useKph}
                brakingZoneSettings={props.brakingZoneSettings}
              />
            </ResizablePanel>
          </ResizablePanelGroup>

          {/* Map toggle button - pinned to bottom of left sidebar */}
          <button
            onClick={toggleMap}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 z-[1001] flex items-center gap-1 px-2 py-0.5 rounded bg-card/90 backdrop-blur-sm border border-border hover:bg-muted/50 text-muted-foreground text-xs"
          >
            {mapVisible ? <><EyeOff className="w-3 h-3" /> Hide Map</> : <><MapIcon className="w-3 h-3" /> Show Map</>}
          </button>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Right panel - 70% */}
      <ResizablePanel defaultSize={70} minSize={40}>
        <GraphPanel
          samples={props.visibleSamples}
          filteredSamples={props.filteredSamples}
          fieldMappings={props.fieldMappings}
          currentIndex={props.currentIndex}
          onScrub={props.onScrub}
          useKph={props.useKph}
          visibleRange={props.visibleRange}
          onRangeChange={props.onRangeChange}
          minRange={props.minRange}
          formatRangeLabel={props.formatRangeLabel}
          gForceSmoothing={props.gForceSmoothing}
          gForceSmoothingStrength={props.gForceSmoothingStrength}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
