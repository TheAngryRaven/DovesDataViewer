import { ResizableSplit } from "@/components/ResizableSplit";
import { RaceLineView } from "@/components/RaceLineView";
import { TelemetryChart } from "@/components/TelemetryChart";
import { RangeSlider } from "@/components/RangeSlider";
import { GpsSample, Course, FieldMapping } from "@/types/racing";

interface RaceLineTabProps {
  visibleSamples: GpsSample[];
  filteredSamples: GpsSample[];
  referenceSamples: GpsSample[];
  currentIndex: number;
  course: Course | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  paceDiff: number | null;
  paceDiffLabel: "best" | "ref";
  deltaTopSpeed: number | null;
  deltaMinSpeed: number | null;
  referenceLapNumber: number | null;
  lapToFastestDelta: number | null;
  showOverlays: boolean;
  lapTimeMs: number | null;
  refAvgTopSpeed: number | null;
  refAvgMinSpeed: number | null;
  sessionGpsPoint?: { lat: number; lon: number };
  sessionStartDate?: Date;
  cachedWeatherStation: import("@/lib/weatherService").WeatherStation | null;
  onWeatherStationResolved: (station: import("@/lib/weatherService").WeatherStation) => void;
  // Telemetry chart props
  fieldMappings: FieldMapping[];
  onScrub: (index: number) => void;
  onFieldToggle: (fieldName: string) => void;
  paceData: (number | null)[];
  referenceSpeedData: (number | null)[];
  hasReference: boolean;
  // Range slider props
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  minRange: number;
  formatRangeLabel: (idx: number) => string;
}

export function RaceLineTab(props: RaceLineTabProps) {
  return (
    <ResizableSplit
      defaultRatio={0.7}
      topPanel={
        <RaceLineView
          samples={props.visibleSamples}
          allSamples={props.filteredSamples}
          referenceSamples={props.referenceSamples}
          currentIndex={props.currentIndex}
          course={props.course}
          bounds={props.bounds}
          paceDiff={props.paceDiff}
          paceDiffLabel={props.paceDiffLabel}
          deltaTopSpeed={props.deltaTopSpeed}
          deltaMinSpeed={props.deltaMinSpeed}
          referenceLapNumber={props.referenceLapNumber}
          lapToFastestDelta={props.lapToFastestDelta}
          showOverlays={props.showOverlays}
          lapTimeMs={props.lapTimeMs}
          refAvgTopSpeed={props.refAvgTopSpeed}
          refAvgMinSpeed={props.refAvgMinSpeed}
          sessionGpsPoint={props.sessionGpsPoint}
          sessionStartDate={props.sessionStartDate}
          cachedWeatherStation={props.cachedWeatherStation}
          onWeatherStationResolved={props.onWeatherStationResolved}
        />
      }
      bottomPanel={
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <TelemetryChart
              samples={props.visibleSamples}
              fieldMappings={props.fieldMappings}
              currentIndex={props.currentIndex}
              onScrub={props.onScrub}
              onFieldToggle={props.onFieldToggle}
              paceData={props.paceData}
              referenceSpeedData={props.referenceSpeedData}
              hasReference={props.hasReference}
            />
          </div>
          {props.filteredSamples.length > 0 && (
            <div className="shrink-0 px-4 py-2 border-t border-border bg-muted/30">
              <RangeSlider
                min={0}
                max={props.filteredSamples.length - 1}
                value={props.visibleRange}
                onChange={props.onRangeChange}
                minRange={props.minRange}
                formatLabel={props.formatRangeLabel}
              />
            </div>
          )}
        </div>
      }
    />
  );
}
