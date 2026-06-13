// Landing-page entry for the Tools plugin (contributed to MountSlot.Landing).
//
// Renders an ActionTile in the home-screen grid that opens the Tools surface in
// a half-screen right-side drawer — visually the same drawer as the Garage
// (FileManagerDrawer), so tools are reachable before any telemetry is loaded.
//
// The landing page renders OUTSIDE the Settings/Session providers, so we read
// both contexts optionally and fall back to nulls (exactly like ProfileTab),
// then host the Tools panel slot. That reuses the in-session machinery (error
// boundaries, Suspense, chromeless layout) and automatically shows every tool —
// no separate sessionless code path.

import { useState } from "react";
import { Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionTile } from "@/components/ActionTile";
import { useOptionalSessionContext } from "@/contexts/SessionContext";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";
import type { LandingContext } from "@/plugins/mounts";

export default function ToolsLandingTile(_props: { ctx: LandingContext }) {
  const [open, setOpen] = useState(false);
  const session = useOptionalSessionContext();
  const settings = useOptionalSettingsContext();

  return (
    <>
      <ActionTile
        icon={Wrench}
        title="Tools"
        description="Trackside calculators and utilities — no datalog needed."
        onClick={() => setOpen(true)}
      />

      {open && (
        <>
          <div className="fixed inset-0 z-[10000] bg-black/40" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-[10001] w-full sm:w-1/2 min-w-[320px] bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Wrench className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-foreground">Tools</h2>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <PluginPanelHost
                slot={PanelSlot.Tools}
                data={session?.data ?? null}
                laps={session?.laps ?? []}
                selectedLapNumber={session?.selectedLapNumber ?? null}
                course={session?.course ?? null}
                useKph={settings?.useKph ?? false}
                sessionSetup={session?.sessionSetup ?? null}
                activeSnapshot={session?.activeSnapshot ?? null}
                fallback={<ToolsEmpty />}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ToolsEmpty() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <Wrench className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">Tools</p>
        <p className="text-xs text-muted-foreground">No tools are available in this build.</p>
      </div>
    </div>
  );
}
