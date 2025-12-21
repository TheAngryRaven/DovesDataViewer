import { Lap, Course, courseHasSectors } from '@/types/racing';
import { formatLapTime, formatSectorTime, calculateOptimalLap } from '@/lib/lapCalculation';
import { Trophy, Sparkles, Timer } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface LapSummaryWidgetProps {
  laps: Lap[];
  course: Course | null;
  selectedLap: Lap | null;
}

export function LapSummaryWidget({ laps, course, selectedLap }: LapSummaryWidgetProps) {
  if (laps.length === 0) return null;

  // Find fastest lap
  const fastestLap = laps.reduce((min, lap) => 
    lap.lapTimeMs < min.lapTimeMs ? lap : min, laps[0]);

  // Calculate optimal lap if sectors available
  const showSectors = courseHasSectors(course);
  const optimalLap = showSectors ? calculateOptimalLap(laps) : null;

  // Calculate delta for selected lap
  const selectedDelta = selectedLap 
    ? selectedLap.lapTimeMs - fastestLap.lapTimeMs 
    : null;

  return (
    <div className="flex items-center gap-4 text-xs font-mono">
      {/* Selected lap with delta to fastest */}
      {selectedLap && (
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Timer className="w-3.5 h-3.5 text-foreground" />
            </TooltipTrigger>
            <TooltipContent>Selected Lap</TooltipContent>
          </Tooltip>
          <span className="text-muted-foreground">Lap {selectedLap.lapNumber}:</span>
          <span className="text-foreground font-semibold">
            {formatLapTime(selectedLap.lapTimeMs)}
          </span>
          {selectedDelta !== null && selectedDelta > 0 && (
            <span className="text-muted-foreground">
              Δ: +{formatSectorTime(selectedDelta)}s
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Trophy className="w-3.5 h-3.5 text-racing-lapBest" />
          </TooltipTrigger>
          <TooltipContent>Fastest Lap</TooltipContent>
        </Tooltip>
        <span className="text-racing-lapBest font-semibold">
          {formatLapTime(fastestLap.lapTimeMs)}
        </span>
      </div>
      
      {optimalLap && (
        <>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              </TooltipTrigger>
              <TooltipContent>Optimal Lap (best sectors combined)</TooltipContent>
            </Tooltip>
            <span className="text-purple-400 font-semibold">
              {formatLapTime(optimalLap.optimalTimeMs)}
            </span>
          </div>
          
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Δ:</span>
            <span className="text-muted-foreground font-semibold">
              +{formatSectorTime(optimalLap.deltaToFastest)}s
            </span>
          </div>
        </>
      )}
    </div>
  );
}