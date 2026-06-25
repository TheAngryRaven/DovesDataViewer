import { RangeSlider } from '@/components/RangeSlider';
import { SectorCropSelect } from '@/components/SectorCropSelect';
import { GpsSample, Course, Lap } from '@/types/racing';

interface GraphRangeControlProps {
  filteredSamples: GpsSample[];
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  minRange: number;
  formatRangeLabel: (idx: number) => string;
  course?: Course | null;
  laps?: Lap[];
  selectedLapNumber?: number | null;
}

/**
 * The graph stack's bottom control: a range slider (80%) + a crop-to-sector
 * select (20%). Split out so it can sit under a single GraphPanel or span the
 * full width beneath both panels in split-graphs mode (one shared control).
 */
export function GraphRangeControl({
  filteredSamples, visibleRange, onRangeChange, minRange, formatRangeLabel,
  course = null, laps = [], selectedLapNumber = null,
}: GraphRangeControlProps) {
  if (filteredSamples.length === 0) return null;
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-border bg-muted/30">
      <div className="flex-[4] min-w-0">
        <RangeSlider
          min={0}
          max={filteredSamples.length - 1}
          value={visibleRange}
          onChange={onRangeChange}
          minRange={minRange}
          formatLabel={formatRangeLabel}
        />
      </div>
      <div className="flex-1 min-w-[88px]">
        <SectorCropSelect
          course={course}
          laps={laps}
          selectedLapNumber={selectedLapNumber}
          filteredLength={filteredSamples.length}
          visibleRange={visibleRange}
          onRangeChange={onRangeChange}
        />
      </div>
    </div>
  );
}
