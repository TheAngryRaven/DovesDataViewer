import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Check, Plus, Spline, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { formatLapTime } from "@/lib/lapCalculation";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import { overlayId, type OverlayLine } from "@/lib/lapOverlays";
import type { SaveSnapshotResult } from "@/hooks/useLapSnapshots";

interface LapSnapshotControlsProps {
  snapshotsForCourse: LapSnapshot[];
  activeSnapshotId: string | null;
  canSnapshot: boolean;
  hasCourse: boolean;
  onLoad: (snap: LapSnapshot) => void;
  onClear: () => void;
  onSave: (force?: boolean) => Promise<SaveSnapshotResult>;
  /** Trigger button text (default "Snapshots"). */
  triggerLabel?: string;
  /** Show the "save current lap" action (default true). Off for a load-only entry. */
  showSave?: boolean;
  /** Active map overlays — drives the per-snapshot "show on map" toggle. */
  overlayLines?: OverlayLine[];
  /** Toggle a snapshot as a map overlay line (by overlay id). */
  onToggleOverlay?: (id: string) => void;
}

/**
 * Lap-list companion for snapshots: save the current lap as a "course fastest
 * lap", and load a saved snapshot as the reference lap (comparison overlay).
 * Loading a snapshot NEVER affects playback or the video player — it rides the
 * reference-overlay slot, not the lap selection.
 */
export function LapSnapshotControls({
  snapshotsForCourse, activeSnapshotId, canSnapshot, hasCourse,
  onLoad, onClear, onSave, triggerLabel, showSave = true,
  overlayLines = [], onToggleOverlay,
}: LapSnapshotControlsProps) {
  const { t } = useTranslation("session");
  const [open, setOpen] = useState(false);
  if (!hasCourse) return null;

  const count = snapshotsForCourse.length;
  const label = triggerLabel ?? t("snapshots.trigger");

  const handleSave = async (force = false) => {
    const result = await onSave(force);
    if (result.saved) {
      toast.success(result.replaced ? t("snapshots.toastUpdated") : t("snapshots.toastSaved"));
      setOpen(false);
    } else if (result.reason === "slower") {
      // Don't silently destroy a faster personal-best baseline — confirm first.
      const ok = window.confirm(
        t("snapshots.confirmOverwrite", { time: formatLapTime(result.existingLapMs ?? 0) }),
      );
      if (ok) await handleSave(true);
    } else if (result.reason === "no-engine") {
      toast.error(t("snapshots.errNoEngine"));
    } else if (result.reason === "no-lap") {
      toast.error(t("snapshots.errNoLap"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm">
          <Camera className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{label}</span>
          {count > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("snapshots.title")}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          {t("snapshots.info")}
        </p>

        {showSave && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              disabled={!canSnapshot}
              onClick={() => void handleSave()}
            >
              <Plus className="h-4 w-4" />
              {t("snapshots.save")}
            </Button>
            {!canSnapshot && (
              <p className="-mt-1 text-[11px] text-muted-foreground">
                {t("snapshots.saveHint")}
              </p>
            )}
          </>
        )}

        <div className="mt-1 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("snapshots.loadAsReference")}
          </p>
          {activeSnapshotId && (
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onClear}>
              <X className="h-3 w-3" />
              {t("snapshots.clear")}
            </Button>
          )}
        </div>

        <div className="-mx-1 flex-1 overflow-y-auto">
          {count === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t("snapshots.empty")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {snapshotsForCourse.map((snap) => {
                const isActive = snap.id === activeSnapshotId;
                const ovId = overlayId("snap", snap.id);
                const overlay = overlayLines.find((l) => l.id === ovId);
                return (
                  <li key={snap.id} className={`flex items-center rounded ${isActive ? "bg-primary/10" : ""}`}>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-muted/50"
                      onClick={() => {
                        if (isActive) {
                          onClear();
                        } else {
                          onLoad(snap);
                          setOpen(false);
                        }
                      }}
                    >
                      {isActive ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {snap.engine || t("snapshots.unknownEngine")}
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {formatLapTime(snap.lapTimeMs)}
                          {snap.vehicle?.name ? ` · ${snap.vehicle.name}` : ""}
                        </span>
                      </span>
                      {isActive && <span className="shrink-0 text-[11px] text-primary">{t("snapshots.showing")}</span>}
                    </button>
                    {onToggleOverlay && (
                      <button
                        type="button"
                        className="ml-1 mr-1 shrink-0 rounded p-1.5 transition-colors hover:bg-muted/50"
                        style={{ color: overlay ? overlay.color : undefined }}
                        title={overlay ? t("snapshots.hideOnMap") : t("snapshots.showOnMap")}
                        aria-pressed={!!overlay}
                        onClick={() => onToggleOverlay(ovId)}
                      >
                        <Spline className={`h-4 w-4 ${overlay ? "" : "text-muted-foreground"}`} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
