import { Lap, Course, courseHasSectors } from '@/types/racing';
import { formatLapTime, formatSectorTime, calculateOptimalLap } from '@/lib/lapCalculation';
import { Trophy, Sparkles, Timer } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface LapSummaryWidgetProps {
  laps: Lap[];
  course: Course | null;
  selectedLap: Lap | null;
  paceDiff?: number | null;
}

export function LapSummaryWidget({ laps, course, selectedLap, paceDiff }: LapSummaryWidgetProps) {
  if (laps.length === 0) return null;

  // Find fastest lap
  const fastestLap = laps.reduce((min, lap) => 
    lap.lapTimeMs < min.lapTimeMs ? lap : min, laps[0]);

  // Calculate optimal lap if sectors available
  const showSectors = courseHasSectors(course);
  const optimalLap = showSectors ? calculateOptimalLap(laps) : null;

  return (
    <div className="flex items-center gap-4 text-xs font-mono">
      {/* Selected lap info */}
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
      )}

      {/* Delta to reference - moved to the right */}
      {paceDiff != null && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Δ:</span>
          <span 
            className="font-semibold"
            style={{ color: paceDiff < 0 ? 'hsl(142, 76%, 45%)' : paceDiff > 0 ? 'hsl(0, 84%, 55%)' : 'hsl(var(--muted-foreground))' }}
          >
            {paceDiff > 0 ? '+' : ''}{paceDiff.toFixed(2)}s
          </span>
        </div>
      )}
    </div>
  );
}