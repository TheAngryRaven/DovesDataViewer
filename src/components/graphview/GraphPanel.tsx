import { useState, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RangeSlider } from '@/components/RangeSlider';
import { SingleSeriesChart } from './SingleSeriesChart';
import { GpsSample, FieldMapping } from '@/types/racing';

const SERIES_COLORS = [
  'hsl(180, 70%, 55%)', 'hsl(45, 85%, 55%)', 'hsl(0, 70%, 55%)',
  'hsl(280, 60%, 60%)', 'hsl(120, 60%, 50%)', 'hsl(30, 80%, 55%)',
  'hsl(200, 80%, 60%)', 'hsl(340, 80%, 55%)',
];

interface GraphPanelProps {
  samples: GpsSample[];
  filteredSamples: GpsSample[];
  fieldMappings: FieldMapping[];
  currentIndex: number;
  onScrub: (index: number) => void;
  useKph: boolean;
  visibleRange: [number, number];
  onRangeChange: (range: [number, number]) => void;
  minRange: number;
  formatRangeLabel: (idx: number) => string;
  gForceSmoothing: boolean;
  gForceSmoothingStrength: number;
}

export function GraphPanel({
  samples, filteredSamples, fieldMappings, currentIndex, onScrub, useKph,
  visibleRange, onRangeChange, minRange, formatRangeLabel,
  gForceSmoothing, gForceSmoothingStrength,
}: GraphPanelProps) {
  const [activeGraphs, setActiveGraphs] = useState<string[]>([]);

  // Available data sources
  const availableSources = useMemo(() => {
    const sources: { key: string; label: string }[] = [
      { key: 'speed', label: `Speed (${useKph ? 'KPH' : 'MPH'})` },
    ];
    fieldMappings.forEach(f => {
      sources.push({ key: f.name, label: f.name + (f.unit ? ` (${f.unit})` : '') });
    });
    return sources;
  }, [fieldMappings, useKph]);

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
                useKph={useKph}
                color={getColor(key)}
                label={getLabel(key)}
                onDelete={() => removeGraph(key)}
                gForceSmoothing={gForceSmoothing}
                gForceSmoothingStrength={gForceSmoothingStrength}
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
