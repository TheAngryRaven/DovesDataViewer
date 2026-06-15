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

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionTile } from "@/components/ActionTile";
import { useOptionalSessionContext } from "@/contexts/SessionContext";
import { useOptionalSettingsContext } from "@/contexts/SettingsContext";
import { PluginPanelHost } from "@/plugins/PluginPanelHost";
import { PanelSlot } from "@/plugins/panels";
import type { LandingContext } from "@/plugins/mounts";
import { useToolsT } from "./i18n";

export default function ToolsLandingTile(_props: { ctx: LandingContext }) {
  const t = useToolsT();
  const [open, setOpen] = useState(false);
  const session = useOptionalSessionContext();
  const settings = useOptionalSettingsContext();

  // While the full-screen panel is open, lock the page behind it so touch
  // gestures don't scroll the landing page — which on a non-installed mobile
  // browser toggles the chrome bar, rubber-bands, and reveals the footer.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  return (
    <>
      <ActionTile
        icon={Wrench}
        title={t("picker.heading")}
        description={t("landing.tileDescription")}
        onClick={() => setOpen(true)}
      />

      {open && createPortal(
        // Portaled to <body> so this full-screen layer owns the viewport rather
        // than living inside the landing page's scroll/stacking context. h-dvh
        // tracks the dynamic mobile viewport so the bottom-pinned content stays
        // put as the browser chrome shows/hides.
        <div className="fixed inset-0 z-[10001] flex h-[100dvh] flex-col bg-background overscroll-none animate-in fade-in duration-150">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-primary" />
              <h2 className="font-semibold text-foreground">{t("picker.heading")}</h2>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden overscroll-contain">
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
        </div>,
        document.body,
      )}
    </>
  );
}

function ToolsEmpty() {
  const t = useToolsT();
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-sm space-y-5 text-center px-4">
        <Wrench className="w-10 h-10 text-muted-foreground/40 mx-auto" />
        <p className="text-sm font-medium text-foreground">{t("picker.heading")}</p>
        <p className="text-xs text-muted-foreground">{t("landing.noTools")}</p>
      </div>
    </div>
  );
}
