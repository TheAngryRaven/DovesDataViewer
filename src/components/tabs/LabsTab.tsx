import { memo } from "react";
import { FlaskConical } from "lucide-react";
import { useSessionContext } from "@/contexts/SessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const LabsTab = memo(function LabsTab() {
  const { data, laps, selectedLapNumber, course } = useSessionContext();
  const { useKph } = useSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Labs}
      data={data}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      course={course}
      useKph={useKph}
      fallback={<LabsEmpty />}
    />
  );
});

function LabsEmpty() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <FlaskConical className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">Labs Features</p>
        <p className="text-xs text-muted-foreground">
          Nothing cooking right now — check back later!
        </p>
      </div>
    </div>
  );
}
