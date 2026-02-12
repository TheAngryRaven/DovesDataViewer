import { memo } from "react";
import { ResizableSplit } from "@/components/ResizableSplit";
import { VideoPlayer } from "@/components/VideoPlayer";
import { TelemetryChart } from "@/components/TelemetryChart";
import { RangeSlider } from "@/components/RangeSlider";
import { GpsSample, FieldMapping } from "@/types/racing";
import type { VideoSyncState, VideoSyncActions } from "@/hooks/useVideoSync";

interface LabsTabProps {
  // Video props
  videoState: VideoSyncState;
  videoActions: VideoSyncActions;
  onVideoLoadedMetadata: () => void;
  currentSample: GpsSample | null;
  // Telemetry chart props
  visibleSamples: GpsSample[];
  filteredSamples: GpsSample[];
  fieldMappings: FieldMapping[];
  currentIndex: number;
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

export const LabsTab = memo(function LabsTab(props: LabsTabProps) {
  return (
    <ResizableSplit
      defaultRatio={0.6}
      topPanel={
        <VideoPlayer
          state={props.videoState}
          actions={props.videoActions}
          onLoadedMetadata={props.onVideoLoadedMetadata}
          currentSample={props.currentSample}
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
});
