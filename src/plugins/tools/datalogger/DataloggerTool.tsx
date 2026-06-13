// Phone Datalogger tool — SKELETON ONLY.
//
// Placeholder shell for using the phone's GPS as a lap-timing datalogger. The
// real capture (high-accuracy, never-cached geolocation → Hz/speed/heading
// derivation → timing feed) is prototyped at the standalone `/gps-test` route
// (pages/GpsTest.tsx + lib/gpsTestMetrics.ts); this tool will host that flow
// inside the Tools surface. Intentionally inert for now.

import { Satellite } from "lucide-react";
import type { PluginPanelProps } from "@/plugins/panels";

export default function DataloggerTool(_props: PluginPanelProps) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <Satellite className="mx-auto h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-base font-semibold text-foreground">Phone Datalogger</h2>
        <p className="text-sm text-muted-foreground">
          Turn your phone into a GPS lap-timing datalogger. This tool is a
          skeleton — the live capture and on-track timing are still being wired
          up.
        </p>
        <p className="text-xs text-muted-foreground/70">Coming soon.</p>
      </div>
    </div>
  );
}
