import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { List } from "lucide-react";
import { ResizableSplit } from "@/components/ResizableSplit";
import { RaceLineView } from "@/components/RaceLineView";
import { TelemetryChart } from "@/components/TelemetryChart";
import { RangeSlider } from "@/components/RangeSlider";
import { SectorCropSelect } from "@/components/SectorCropSelect";
import { useSessionContext } from "@/contexts/SessionContext";

interface RaceLineTabProps {
  showOverlays: boolean;
}

export const RaceLineTab = memo(function RaceLineTab({ showOverlays }: RaceLineTabProps) {
  const s = useSessionContext();
  const { t } = useTranslation("session");
  const [showLegend, setShowLegend] = useState(true);
  return (
    <ResizableSplit
      defaultRatio={0.7}
      dividerStart={
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowLegend((v) => !v);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`p-1 rounded hover:bg-primary/20 transition-colors ${showLegend ? "" : "opacity-40"}`}
          title={showLegend ? t("controls.hideLegend") : t("controls.showLegend")}
        >
          <List className="w-5 h-5 text-muted-foreground" />
        </button>
      }
      topPanel={
        <RaceLineView
          samples={s.visibleSamples}
          allSamples={s.filteredSamples}
          referenceSamples={s.referenceSamples}
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
          sessionFileName={s.sessionFileName}
          cachedWeatherStation={s.cachedWeatherStation}
          onWeatherStationResolved={s.onWeatherStationResolved}
          isAllLaps={s.isAllLaps}
          parserStats={s.parserStats}
          overlayLines={s.overlayLines}
          rangeStart={s.visibleRange[0]}
          onRemoveOverlay={s.onToggleOverlay}
          alignOverlays={s.alignOverlays}
          onToggleAlignOverlays={s.onToggleAlignOverlays}
          showOverlayLegend={s.showOverlayLegend}
          onToggleOverlayLegend={s.onToggleOverlayLegend}
        />
      }
      bottomPanel={
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0">
            <TelemetryChart
              samples={s.visibleSamples}
              fieldMappings={s.fieldMappings}
              onScrub={s.onScrub}
              onFieldToggle={s.onFieldToggle}
              paceData={s.paceData}
              referenceSpeedData={s.referenceSpeedData}
              hasReference={s.hasReference}
              allSamples={s.filteredSamples}
              rangeStart={s.visibleRange[0]}
              overlayLines={s.overlayLines}
              showLegend={showLegend}
            />
          </div>
          {s.filteredSamples.length > 0 && (
            <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-border bg-muted/30">
              <div className="flex-[4] min-w-0">
                <RangeSlider
                  min={0}
                  max={s.filteredSamples.length - 1}
                  value={s.visibleRange}
                  onChange={s.onRangeChange}
                  minRange={s.minRange}
                  formatLabel={s.formatRangeLabel}
                />
              </div>
              <div className="flex-1 min-w-[88px]">
                <SectorCropSelect
                  course={s.course}
                  laps={s.laps}
                  selectedLapNumber={s.selectedLapNumber}
                  filteredLength={s.filteredSamples.length}
                  visibleRange={s.visibleRange}
                  onRangeChange={s.onRangeChange}
                />
              </div>
            </div>
          )}
        </div>
      }
    />
  );
});
