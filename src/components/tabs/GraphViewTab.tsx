import { BarChart3 } from "lucide-react";

export function GraphViewTab() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4">
      <BarChart3 className="w-16 h-16 text-primary/30" />
      <div className="text-center space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Graph View — Coming Soon</h2>
        <p className="text-sm max-w-md">
          Individual telemetry channels with independent scales. Each graph will display one or two
          series with its own Y-axis for precise analysis.
        </p>
      </div>
    </div>
  );
}
