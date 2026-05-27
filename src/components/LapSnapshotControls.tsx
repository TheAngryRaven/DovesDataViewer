import { useState } from "react";
import { Camera, Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { formatLapTime } from "@/lib/lapCalculation";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import type { SaveSnapshotResult } from "@/hooks/useLapSnapshots";

interface LapSnapshotControlsProps {
  snapshotsForCourse: LapSnapshot[];
  activeSnapshotId: string | null;
  canSnapshot: boolean;
  hasCourse: boolean;
  onLoad: (snap: LapSnapshot) => void;
  onClear: () => void;
  onSave: () => Promise<SaveSnapshotResult>;
}

/**
 * Lap-list companion for snapshots: save the current lap as a "course fastest
 * lap", and load a saved snapshot as a comparison overlay. Loading a snapshot
 * NEVER affects playback or the video player — it rides the reference-overlay
 * slot, not the lap selection.
 */
export function LapSnapshotControls({
  snapshotsForCourse, activeSnapshotId, canSnapshot, hasCourse,
  onLoad, onClear, onSave,
}: LapSnapshotControlsProps) {
  const [open, setOpen] = useState(false);
  if (!hasCourse) return null;

  const count = snapshotsForCourse.length;

  const handleSave = async () => {
    const result = await onSave();
    if (result.saved) {
      toast.success(result.replaced ? "Course fastest lap updated." : "Lap snapshot saved.");
      setOpen(false);
    } else if (result.reason === "no-engine") {
      toast.error("Assign an engine (vehicle) to this session first.");
    } else if (result.reason === "no-lap") {
      toast.error("No lap to snapshot yet.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-sm">
          <Camera className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Snapshots</span>
          {count > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Lap Snapshots</DialogTitle>
        </DialogHeader>

        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={!canSnapshot}
          onClick={() => void handleSave()}
        >
          <Plus className="h-4 w-4" />
          Save current lap as snapshot
        </Button>
        {!canSnapshot && (
          <p className="-mt-1 text-[11px] text-muted-foreground">
            Assign an engine to this session to capture its fastest lap.
          </p>
        )}

        <div className="mt-1 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Compare a snapshot (this course)
          </p>
          {activeSnapshotId && (
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={onClear}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        <div className="-mx-1 flex-1 overflow-y-auto">
          {count === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No snapshots saved for this course yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {snapshotsForCourse.map((snap) => {
                const isActive = snap.id === activeSnapshotId;
                return (
                  <li key={snap.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-muted/50 ${
                        isActive ? "bg-primary/10" : ""
                      }`}
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
                          {snap.engine || "Unknown engine"}
                        </span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {formatLapTime(snap.lapTimeMs)}
                          {snap.vehicle?.name ? ` · ${snap.vehicle.name}` : ""}
                        </span>
                      </span>
                      {isActive && <span className="shrink-0 text-[11px] text-primary">Showing</span>}
                    </button>
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
