import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors } from 'lucide-react';
import { Course, Lap } from '@/types/racing';
import { normalizeCourseSectors, sectorLabels } from '@/lib/courseSectors';

interface SectorCropSelectProps {
  course: Course | null;
  laps: Lap[];
  selectedLapNumber: number | null;
  /** Number of samples in the active (lap-filtered) window. */
  filteredLength: number;
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
}

interface CropOption {
  key: string;
  label: string;
  range: [number, number];
}

/**
 * Quick crop-to-sector dropdown that sits next to the range slider. Picking a
 * sector snaps the visible window to that section of the selected lap — handy
 * for coaches reviewing a specific corner in a predictable way. Disabled when
 * viewing all laps (sector spans are per-lap) or the course has no sectors.
 */
export function SectorCropSelect({
  course, laps, selectedLapNumber, filteredLength, visibleRange, onRangeChange,
}: SectorCropSelectProps) {
  const { t } = useTranslation('session');
  const lap = selectedLapNumber === null ? null : laps.find((l) => l.lapNumber === selectedLapNumber) ?? null;

  const options = useMemo<CropOption[]>(() => {
    const opts: CropOption[] = [{ key: 'full', label: 'Full lap', range: [0, Math.max(0, filteredLength - 1)] }];
    if (!course || !lap || !lap.sectorBoundaries || lap.sectorBoundaries.length === 0) return opts;

    const labels = sectorLabels(course);
    const lineCount = labels.length;
    const bounds = lap.sectorBoundaries; // absolute sample indices, [0] = lap start
    const clamp = (n: number) => Math.max(0, Math.min(n, filteredLength - 1));

    for (let k = 0; k < lineCount; k++) {
      const startAbs = bounds[k];
      const endAbs = k + 1 < lineCount ? bounds[k + 1] : lap.endIndex;
      if (startAbs === undefined || endAbs === undefined) continue; // missed crossing
      const startRel = clamp(startAbs - lap.startIndex);
      const endRel = clamp(endAbs - lap.startIndex);
      if (endRel <= startRel) continue;
      opts.push({ key: `s-${k}`, label: labels[k], range: [startRel, endRel] });
    }
    return opts;
  }, [course, lap, filteredLength]);

  const hasSectorOptions = options.length > 1;
  const disabled = !hasSectorOptions;

  // Reflect the current window: match it to an option, else "Custom".
  const currentKey = useMemo(() => {
    const match = options.find((o) => o.range[0] === visibleRange[0] && o.range[1] === visibleRange[1]);
    return match ? match.key : 'custom';
  }, [options, visibleRange]);

  const handleChange = (key: string) => {
    const opt = options.find((o) => o.key === key);
    if (opt) onRangeChange(opt.range);
  };

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('crop.title')}>
      <Scissors className="w-3.5 h-3.5 shrink-0" />
      <select
        value={currentKey}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 cursor-pointer rounded border border-border bg-transparent px-1 py-0.5 text-xs text-foreground/90 outline-none disabled:cursor-not-allowed disabled:opacity-50"
        title={disabled ? t('crop.disabledTitle') : t('crop.enabledTitle')}
      >
        {currentKey === 'custom' && <option value="custom">{t('crop.customRange')}</option>}
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.key === 'full' ? t('crop.fullLap') : t('crop.sector', { label: o.label })}
          </option>
        ))}
      </select>
    </label>
  );
}
