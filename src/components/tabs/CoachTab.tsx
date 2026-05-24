import { memo } from "react";
import { Gauge } from "lucide-react";
import { useSessionContext } from "@/contexts/SessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const CoachTab = memo(function CoachTab() {
  const { data, laps, selectedLapNumber, course } = useSessionContext();
  const { useKph } = useSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Coach}
      data={data}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      course={course}
      useKph={useKph}
      fallback={<CoachEmpty />}
    />
  );
});

function CoachEmpty() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <Gauge className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">AI Coach</p>
        <p className="text-xs text-muted-foreground">
          The coaching plugin isn’t loaded in this build.
        </p>
      </div>
    </div>
  );
}
