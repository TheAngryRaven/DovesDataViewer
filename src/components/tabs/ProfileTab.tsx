import { memo } from "react";
import { User } from "lucide-react";
import { useSessionContext } from "@/contexts/SessionContext";
import { useSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const ProfileTab = memo(function ProfileTab() {
  const { data, laps, selectedLapNumber, course } = useSessionContext();
  const { useKph } = useSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Profile}
      data={data}
      laps={laps}
      selectedLapNumber={selectedLapNumber}
      course={course}
      useKph={useKph}
      fallback={<ProfileEmpty />}
    />
  );
});

function ProfileEmpty() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <User className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">Profile</p>
        <p className="text-xs text-muted-foreground">
          Profile &amp; storage are unavailable in this build.
        </p>
      </div>
    </div>
  );
}
