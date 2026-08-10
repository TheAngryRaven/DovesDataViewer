import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildPickerState,
  initialPickerSelection,
  togglePickerCourse,
} from "@/lib/deviceCoursePicker";
import { overridesFromSelection } from "@/lib/deviceCourseSelection";
import type { TrackCourseOverrides } from "@/lib/deviceCourseSelection";
import type { Track } from "@/types/racing";

/**
 * Choose which of a track's courses live on the logger (plan 0017).
 *
 * The logger reads a whole track file into a fixed buffer; past it the track
 * stops being detected at the venue entirely. This is where a track that
 * doesn't fit gets trimmed — deliberately, by the user, with the real byte
 * count in front of them.
 *
 * Everything it decides comes from `deviceCoursePicker`, which is unit-tested;
 * this only draws it. Courses left unchecked stay in the app and on cloud sync
 * — only the card holds a subset.
 */
export function DeviceCoursePickerDialog({
  open,
  onOpenChange,
  track,
  budget,
  overrides,
  saving = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  track: Track;
  budget: number;
  overrides?: TrackCourseOverrides;
  saving?: boolean;
  onConfirm: (overrides: TrackCourseOverrides, selectedNames: string[]) => void;
}) {
  const { t, i18n } = useTranslation("drawer");
  const [selected, setSelected] = useState<string[]>([]);

  // Rebuild on open: the track is a snapshot, and a stale selection would be
  // checked against courses that have since been renamed or deleted.
  useEffect(() => {
    if (open) setSelected(initialPickerSelection(track.courses, overrides));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const state = useMemo(
    () => buildPickerState(track, selected, budget),
    [track, selected, budget],
  );

  const walked = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deviceTracks.picker.title", { name: track.name })}</DialogTitle>
          <DialogDescription>
            {state.accumulates
              ? t("deviceTracks.picker.descriptionSprint")
              : t("deviceTracks.picker.descriptionCircuit")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
          {state.rows.map((row) => (
            <button
              key={row.name}
              type="button"
              role="checkbox"
              aria-checked={row.selected}
              disabled={saving}
              onClick={() => setSelected((s) => togglePickerCourse(s, row.name))}
              className={`w-full flex items-start gap-2 text-sm text-left ${
                saving ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  row.selected
                    ? "bg-primary border-primary text-primary-foreground"
                    : "border-input"
                }`}
              >
                {row.selected && <Check className="w-3 h-3" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-foreground">{row.name}</span>
                  {state.accumulates && row.isDefault && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                      {t("deviceTracks.picker.newestBadge")}
                    </span>
                  )}
                </span>
                {row.dateCreated && (
                  <span className="block text-xs text-muted-foreground">
                    {t("deviceTracks.wizard.walkedOn", { date: walked(row.dateCreated) })}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="text-sm">
          {state.overBy > 0 ? (
            <span className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {t("deviceTracks.picker.overBudget", {
                over: state.overBy,
                budget: state.budget,
              })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("deviceTracks.picker.withinBudget", {
                bytes: state.bytes,
                budget: state.budget,
              })}
            </span>
          )}
          {state.rows.every((r) => !r.selected) && (
            <span className="block text-amber-400 mt-1">
              {t("deviceTracks.picker.needOne")}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("deviceTracks.picker.cancel")}
          </Button>
          <Button
            onClick={() => onConfirm(overridesFromSelection(track.courses, selected), selected)}
            disabled={!state.canConfirm || saving}
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("deviceTracks.picker.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
