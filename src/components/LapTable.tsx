import { Lap } from '@/types/racing';
import { formatLapTime } from '@/lib/lapCalculation';
import { Trophy, Zap } from 'lucide-react';

interface LapTableProps {
  laps: Lap[];
  onLapSelect?: (lap: Lap) => void;
  selectedLapNumber?: number | null;
}

export function LapTable({ laps, onLapSelect, selectedLapNumber }: LapTableProps) {
  if (laps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-center">
          No laps detected.<br />
          <span className="text-sm">Select a track with a start/finish line</span>
        </p>
      </div>
    );
  }

  // Find fastest lap and fastest top speed
  const fastestLapIdx = laps.reduce((minIdx, lap, idx, arr) => 
    lap.lapTimeMs < arr[minIdx].lapTimeMs ? idx : minIdx, 0);
  
  const fastestSpeedIdx = laps.reduce((maxIdx, lap, idx, arr) => 
    lap.maxSpeedMph > arr[maxIdx].maxSpeedMph ? idx : maxIdx, 0);

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <table className="w-full">
        <thead className="sticky top-0 bg-card">
          <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="px-4 py-3 font-medium">Lap</th>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Top Speed</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap, idx) => {
            const isFastest = idx === fastestLapIdx;
            const hasFastestSpeed = idx === fastestSpeedIdx;
            
            return (
              <tr
                key={lap.lapNumber}
                onClick={() => onLapSelect?.(lap)}
                className={`
                  border-t border-border cursor-pointer transition-colors
                  ${selectedLapNumber === lap.lapNumber ? 'bg-primary/20 ring-1 ring-primary/50' : ''}
                  ${isFastest && selectedLapNumber !== lap.lapNumber ? 'bg-racing-lapBest/10' : ''}
                  ${!isFastest && selectedLapNumber !== lap.lapNumber ? 'hover:bg-muted/50' : ''}
                `}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{lap.lapNumber}</span>
                    {isFastest && (
                      <Trophy className="w-4 h-4 text-racing-lapBest" />
                    )}
                  </div>
                </td>
                <td className={`px-4 py-3 font-mono text-sm ${isFastest ? 'text-racing-lapBest font-semibold' : ''}`}>
                  {formatLapTime(lap.lapTimeMs)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">
                      {lap.maxSpeedMph.toFixed(1)} mph
                    </span>
                    {hasFastestSpeed && (
                      <Zap className="w-4 h-4 text-accent" />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary */}
      <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3">
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Best Lap: </span>
            <span className="font-mono text-racing-lapBest font-semibold">
              {formatLapTime(laps[fastestLapIdx].lapTimeMs)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Max Speed: </span>
            <span className="font-mono text-accent font-semibold">
              {laps[fastestSpeedIdx].maxSpeedMph.toFixed(1)} mph
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
