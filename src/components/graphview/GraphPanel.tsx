import { useState, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RangeSlider } from '@/components/RangeSlider';
import { SingleSeriesChart } from './SingleSeriesChart';
import { GpsSample, FieldMapping } from '@/types/racing';
import { calculatePace, calculateReferenceSpeed, calculateDistanceArray } from '@/lib/referenceUtils';
import { computeBrakingGSeriesSG } from '@/lib/brakingZones';
import { useSettingsContext } from '@/contexts/SettingsContext';

const SERIES_COLORS = [
  'hsl(180, 70%, 55%)', 'hsl(45, 85%, 55%)', 'hsl(0, 70%, 55%)',
  'hsl(280, 60%, 60%)', 'hsl(120, 60%, 50%)', 'hsl(30, 80%, 55%)',
  'hsl(200, 80%, 60%)', 'hsl(340, 80%, 55%)',
];

interface GraphPanelProps {
  samples: GpsSample[];
  filteredSamples: GpsSample[];
  referenceSamples: GpsSample[];
  fieldMappings: FieldMapping[];
  currentIndex: number;
  onScrub: (index: number) => void;
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  minRange: number;
  formatRangeLabel: (idx: number) => string;
}

export function GraphPanel({
  samples, filteredSamples, referenceSamples, fieldMappings, currentIndex, onScrub,
  visibleRange, onRangeChange, minRange, formatRangeLabel,
}: GraphPanelProps) {
  const { useKph, brakingZoneSettings } = useSettingsContext();
  const [activeGraphs, setActiveGraphs] = useState<string[]>([]);

  const hasReference = referenceSamples.length > 0;

  // Compute braking G series from FULL dataset using SG filter for smooth graph
  const brakingGFull = useMemo(() => {
    if (filteredSamples.length < 3) return [];
    return computeBrakingGSeriesSG(filteredSamples, brakingZoneSettings.graphWindow);
  }, [filteredSamples, brakingZoneSettings.graphWindow]);

  // Compute braking G for reference samples using SG filter
  const brakingGRefFull = useMemo(() => {
    if (!hasReference || referenceSamples.length < 3) return [];
    return computeBrakingGSeriesSG(referenceSamples, brakingZoneSettings.graphWindow);
  }, [referenceSamples, brakingZoneSettings.graphWindow, hasReference]);

  // Precompute reference values for each channel from FULL dataset, then slice for visible range
  const referenceValuesByKey = useMemo(() => {
    if (!hasReference || filteredSamples.length === 0) return {};

    const result: Record<string, (number | null)[]> = {};

    // Reference speed (computed from full filteredSamples)
    result['speed'] = calculateReferenceSpeed(filteredSamples, referenceSamples, useKph);

    // Pace
    result['__pace__'] = calculatePace(filteredSamples, referenceSamples);

    // Braking G reference - interpolated by distance
    if (brakingGRefFull.length > 0) {
      const currentDistances = calculateDistanceArray(filteredSamples);
      const refDistances = calculateDistanceArray(referenceSamples);
      const refBrakingG: (number | null)[] = [];
      for (let i = 0; i < filteredSamples.length; i++) {
        const targetDist = currentDistances[i];
        let lo = 0, hi = refDistances.length - 1;
        while (lo < hi - 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (refDistances[mid] <= targetDist) lo = mid; else hi = mid;
        }
        if (targetDist > refDistances[refDistances.length - 1]) { refBrakingG.push(null); continue; }
        const d1 = refDistances[lo], d2 = refDistances[hi];
        if (d2 === d1) { refBrakingG.push(brakingGRefFull[lo]); continue; }
        const t = (targetDist - d1) / (d2 - d1);
        refBrakingG.push(brakingGRefFull[lo] + t * (brakingGRefFull[hi] - brakingGRefFull[lo]));
      }
      result['__braking_g__'] = refBrakingG;
    }

    // For extra fields, interpolate by distance using full dataset
    const currentDistances = calculateDistanceArray(filteredSamples);
    const refDistances = calculateDistanceArray(referenceSamples);

    fieldMappings.forEach(f => {
      const refValues: (number | null)[] = [];
      for (let i = 0; i < filteredSamples.length; i++) {
        const targetDist = currentDistances[i];
        let lo = 0, hi = refDistances.length - 1;
        while (lo < hi - 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (refDistances[mid] <= targetDist) lo = mid; else hi = mid;
        }
        const d1 = refDistances[lo], d2 = refDistances[hi];
        if (targetDist > refDistances[refDistances.length - 1]) { refValues.push(null); continue; }
        if (d2 === d1) { refValues.push(referenceSamples[lo].extraFields[f.name] ?? null); continue; }
        const t = (targetDist - d1) / (d2 - d1);
        const v1 = referenceSamples[lo].extraFields[f.name];
        const v2 = referenceSamples[hi].extraFields[f.name];
        if (v1 === undefined || v2 === undefined) { refValues.push(null); continue; }
        refValues.push(v1 + t * (v2 - v1));
      }
      result[f.name] = refValues;
    });

    return result;
  }, [filteredSamples, referenceSamples, fieldMappings, useKph, hasReference, brakingGRefFull]);

  // Available data sources
  const availableSources = useMemo(() => {
    const sources: { key: string; label: string }[] = [
      { key: 'speed', label: `Speed (${useKph ? 'KPH' : 'MPH'})` },
    ];
    if (hasReference) {
      sources.push({ key: '__pace__', label: 'Pace (Δs)' });
    }
    sources.push({ key: '__braking_g__', label: 'Braking G' });
    fieldMappings.forEach(f => {
      sources.push({ key: f.name, label: f.name + (f.unit ? ` (${f.unit})` : '') });
    });
    return sources;
  }, [fieldMappings, useKph, hasReference]);

  const unusedSources = useMemo(() => {
    return availableSources.filter(s => !activeGraphs.includes(s.key));
  }, [availableSources, activeGraphs]);

  const addGraph = useCallback((key: string) => {
    if (key && !activeGraphs.includes(key)) {
      setActiveGraphs(prev => [...prev, key]);
    }
  }, [activeGraphs]);

  const removeGraph = useCallback((key: string) => {
    setActiveGraphs(prev => prev.filter(k => k !== key));
  }, []);

  const getColor = (key: string) => {
    if (key === '__pace__') return 'hsl(50, 85%, 55%)';
    if (key === '__braking_g__') return 'hsl(15, 80%, 55%)';
    const idx = availableSources.findIndex(s => s.key === key);
    return SERIES_COLORS[idx % SERIES_COLORS.length];
  };

  const getLabel = (key: string) => {
    return availableSources.find(s => s.key === key)?.label ?? key;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable graph area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeGraphs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4">
            <p className="text-sm">Add a data source to begin</p>
            {unusedSources.length > 0 && (
              <Select onValueChange={addGraph}>
                <SelectTrigger className="w-[200px] h-9">
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    <SelectValue placeholder="Add Graph" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {unusedSources.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ) : (
          <>
            {activeGraphs.map(key => (
              <SingleSeriesChart
                key={key}
                samples={samples}
                seriesKey={key}
                currentIndex={currentIndex}
                onScrub={onScrub}
                color={getColor(key)}
                label={getLabel(key)}
                onDelete={() => removeGraph(key)}
                referenceValues={referenceValuesByKey[key]?.slice(visibleRange[0], visibleRange[1] + 1) ?? null}
                brakingGValues={key === '__braking_g__' ? brakingGFull.slice(visibleRange[0], visibleRange[1] + 1) : undefined}
              />
            ))}
            {/* Add more button */}
            {unusedSources.length > 0 && (
              <div className="flex justify-center py-3">
                <Select onValueChange={addGraph}>
                  <SelectTrigger className="w-[180px] h-8 text-sm">
                    <div className="flex items-center gap-2">
                      <Plus className="w-3.5 h-3.5" />
                      <SelectValue placeholder="Add Graph" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {unusedSources.map(s => (
                      <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Range slider - fixed at bottom */}
      {filteredSamples.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-border bg-muted/30">
          <RangeSlider
            min={0}
            max={filteredSamples.length - 1}
            value={visibleRange}
            onChange={onRangeChange}
            minRange={minRange}
            formatLabel={formatRangeLabel}
          />
        </div>
      )}
    </div>
  );
}
