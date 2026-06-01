import { memo } from "react";
import { User } from "lucide-react";
import { useOptionalSessionContext } from "@/contexts/SessionContext";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";

export const ProfileTab = memo(function ProfileTab() {
  // Profile lives in the file-manager drawer, which also opens from the landing
  // page before any session exists — read both contexts optionally and fall
  // back to empty/default values so the account & storage panels still render.
  const session = useOptionalSessionContext();
  const settings = useOptionalSettingsContext();

  return (
    <PluginPanelHost
      slot={PanelSlot.Profile}
      data={session?.data ?? null}
      laps={session?.laps ?? []}
      selectedLapNumber={session?.selectedLapNumber ?? null}
      course={session?.course ?? null}
      useKph={settings?.useKph ?? false}
      sessionSetup={session?.sessionSetup ?? null}
      activeSnapshot={session?.activeSnapshot ?? null}
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
