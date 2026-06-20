import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Emergency migration notice for the OLD domain. HackTheTrack is moving to
// LapWing (lapwingdata.com), which is a different origin — so local-only files
// (IndexedDB/localStorage) do NOT carry over. This banner warns users on the old
// host to create an account (cloud sync follows them) or export a copy before the
// old site is shut down.
//
// Host-gated: only renders on hackthetrack.net. The new domain never shows it.
// `?migrate=preview` forces it on any host for testing.

const NEW_SITE = "https://lapwingdata.com";
// The day the old site (hackthetrack.net) is taken down. Local-only data is lost
// after this unless exported or moved to an account.
const KILL_DATE = new Date("2026-07-20T00:00:00Z");
const KILL_DATE_LABEL = "July 20, 2026";
const DISMISS_KEY = "htt-migration-dismissed"; // session-only, so it returns next visit

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

/** True on the legacy domain (or when explicitly previewed). */
function onOldSite(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  const isOld = host === "hackthetrack.net" || host === "www.hackthetrack.net";
  const preview = window.location.search.includes("migrate=preview");
  return isOld || preview;
}

function daysUntilKill(now: number = Date.now()): number {
  return Math.max(0, Math.ceil((KILL_DATE.getTime() - now) / 86_400_000));
}

export function MigrationBanner() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [exporting, setExporting] = useState(false);

  if (!onOldSite() || dismissed) return null;

  const days = daysUntilKill();
  const closed = days <= 0;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      // Dynamic import keeps the cloud-sync/export + Supabase chunk off the
      // eager graph; the export gathers local data even when signed out.
      const { downloadAccountExport } = await import("@/plugins/cloud-sync/accountExport");
      await downloadAccountExport();
      toast.success("Your data export has started downloading.");
    } catch {
      toast.error("Couldn't export here — open Profile → Data & privacy to download your data.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="w-full border-b border-warning/60 bg-warning/10 px-4 py-3 text-warning">
      <div className="mx-auto flex w-full max-w-4xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">
            HackTheTrack is moving to <span className="font-bold">LapWing</span> at{" "}
            <span className="font-bold">lapwingdata.com</span>.{" "}
            {closed
              ? "This site (hackthetrack.net) is closing."
              : `This site (hackthetrack.net) shuts down on ${KILL_DATE_LABEL} (${days} day${days === 1 ? "" : "s"} left).`}
          </p>
          <p className="text-xs">
            Your files are saved only in this browser and <strong>won't carry over</strong> to the
            new site. Keep them by {enableCloud ? "creating a free account (your data syncs to the new site) or " : ""}
            exporting a copy now.
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            {enableCloud && (
              <Button size="sm" onClick={() => navigate("/register")}>
                Create free account
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={exporting} onClick={() => void runExport()}>
              {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export my data
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={NEW_SITE} target="_blank" rel="noopener noreferrer">Go to LapWing →</a>
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-warning/80 transition-colors hover:bg-warning/20 hover:text-warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
