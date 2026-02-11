import { useState } from 'react';
import { GpsSample, Course, FieldMapping } from '@/types/racing';
import { Kart } from '@/lib/kartStorage';
import { KartSetup } from '@/lib/setupStorage';
import { WeatherStation } from '@/lib/weatherService';
import { InfoBox } from './InfoBox';
import { MiniMap, BrakingZoneSettings } from './MiniMap';
import { GraphPanel } from './GraphPanel';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

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
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left sidebar - 30% */}
      <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
        <div className="h-full flex flex-col min-h-0">
          {/* Info box - 70% */}
          <div className="flex-[7] min-h-0 overflow-hidden">
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
          </div>
          {/* Mini map - 30% */}
          <div className="flex-[3] min-h-0">
            <MiniMap
              samples={props.visibleSamples}
              allSamples={props.filteredSamples}
              currentIndex={props.currentIndex}
              course={props.course}
              bounds={props.bounds}
              useKph={props.useKph}
              brakingZoneSettings={props.brakingZoneSettings}
            />
          </div>
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
