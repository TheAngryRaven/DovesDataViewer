import { memo } from "react";
import { ResizableSplit } from "@/components/ResizableSplit";
import { RaceLineView } from "@/components/RaceLineView";
import { TelemetryChart } from "@/components/TelemetryChart";
import { RangeSlider } from "@/components/RangeSlider";
import { useSessionContext } from "@/contexts/SessionContext";

interface RaceLineTabProps {
  showOverlays: boolean;
}

export const RaceLineTab = memo(function RaceLineTab({ showOverlays }: RaceLineTabProps) {
  const s = useSessionContext();
  return (
    <ResizableSplit
      defaultRatio={0.7}
      topPanel={
        <RaceLineView
          samples={s.visibleSamples}
          allSamples={s.filteredSamples}
          referenceSamples={s.referenceSamples}
          currentIndex={s.currentIndex}
          course={s.course}
          bounds={s.bounds!}
          paceDiff={s.paceDiff}
          paceDiffLabel={s.paceDiffLabel}
          deltaTopSpeed={s.deltaTopSpeed}
          deltaMinSpeed={s.deltaMinSpeed}
          referenceLapNumber={s.referenceLapNumber}
          lapToFastestDelta={s.lapToFastestDelta}
          showOverlays={showOverlays}
          lapTimeMs={s.selectedLapTimeMs}
          refAvgTopSpeed={s.refAvgTopSpeed}
          refAvgMinSpeed={s.refAvgMinSpeed}
          sessionGpsPoint={s.sessionGpsPoint}
          sessionStartDate={s.sessionStartDate}
          cachedWeatherStation={s.cachedWeatherStation}
          onWeatherStationResolved={s.onWeatherStationResolved}
          isAllLaps={s.isAllLaps}
          parserStats={s.parserStats}
          overlayLines={s.overlayLines}
          rangeStart={s.visibleRange[0]}
          onRemoveOverlay={s.onToggleOverlay}
          alignOverlays={s.alignOverlays}
          onToggleAlignOverlays={s.onToggleAlignOverlays}
          overlaysVisible={s.overlaysVisible}
          onToggleOverlaysVisible={s.onToggleOverlaysVisible}
        />
      }
      bottomPanel={
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <TelemetryChart
              samples={s.visibleSamples}
              fieldMappings={s.fieldMappings}
              currentIndex={s.currentIndex}
              onScrub={s.onScrub}
              onFieldToggle={s.onFieldToggle}
              paceData={s.paceData}
              referenceSpeedData={s.referenceSpeedData}
              hasReference={s.hasReference}
              allSamples={s.filteredSamples}
              rangeStart={s.visibleRange[0]}
              overlayLines={s.overlayLines}
            />
          </div>
          {s.filteredSamples.length > 0 && (
            <div className="shrink-0 px-4 py-2 border-t border-border bg-muted/30">
              <RangeSlider
                min={0}
                max={s.filteredSamples.length - 1}
                value={s.visibleRange}
                onChange={s.onRangeChange}
                minRange={s.minRange}
                formatLabel={s.formatRangeLabel}
              />
            </div>
          )}
        </div>
      }
    />
  );
});
