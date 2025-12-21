import { Lap, Course, courseHasSectors } from '@/types/racing';
import { formatLapTime, formatSectorTime, calculateOptimalLap } from '@/lib/lapCalculation';
import { Trophy, Sparkles } from 'lucide-react';

interface LapSummaryWidgetProps {
  laps: Lap[];
  course: Course | null;
}

export function LapSummaryWidget({ laps, course }: LapSummaryWidgetProps) {
  if (laps.length === 0) return null;

  // Find fastest lap
  const fastestLap = laps.reduce((min, lap) => 
    lap.lapTimeMs < min.lapTimeMs ? lap : min, laps[0]);

  // Calculate optimal lap if sectors available
  const showSectors = courseHasSectors(course);
  const optimalLap = showSectors ? calculateOptimalLap(laps) : null;

  return (
    <div className="flex items-center gap-4 text-xs font-mono">
      <div className="flex items-center gap-1.5">
        <Trophy className="w-3.5 h-3.5 text-racing-lapBest" />
        <span className="text-muted-foreground">Fastest:</span>
        <span className="text-racing-lapBest font-semibold">
          {formatLapTime(fastestLap.lapTimeMs)}
        </span>
      </div>
      
      {optimalLap && (
        <>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-muted-foreground">Optimal:</span>
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