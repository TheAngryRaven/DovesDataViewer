import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DeviceDetails } from "@/lib/loggers";
import { deleteTrack as deleteAppTrack, saveSyncedTrack } from "@/lib/trackStorage";
import { parseDeviceGeneratedName } from "@/lib/deviceGeneratedNames";
import type { NameProblem } from "@/lib/deviceSyncNames";
import type { SkipReason, SyncDirection, SyncPlan } from "@/lib/deviceSyncPlan";
import { planOperations } from "@/lib/deviceSyncOps";
import { loadTrackOverrides } from "@/lib/deviceCourseOverrides";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { runSyncOperations, type SyncExecutors } from "@/lib/deviceSyncRunner";
import {
  canAdvance,
  canSave,
  courseProblems,
  goToCourses,
  goToTracks,
  initWizard,
  resolutions,
  selectedCourseRows,
  selectedRows,
  setCourseName,
  setTrackName,
  setTrackShortName,
  toggleRow,
  trackProblems,
  type ReservedShortName,
} from "@/lib/deviceSyncWizard";

/**
 * The two-screen sync wizard: name the tracks, then their courses, then write
 * both sides.
 *
 * Everything this renders is decided in `@/lib/deviceSyncWizard` and friends —
 * the test environment is `node` with no testing-library, so a component cannot
 * be rendered and any logic left here is logic nobody checks. This file holds
 * one `useState` and the markup.
 */

const DIRECTION_STYLE: Record<SyncDirection, string> = {
  upload: "bg-primary/20 text-primary",
  download: "bg-sky-500/20 text-sky-400",
};

/** Locale-aware, and UTC — the name encodes the GPS clock, not the viewer's. */
function formatWalkedOn(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function DeviceSyncWizard({
  open,
  onOpenChange,
  plan,
  reserved = [],
  details,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: SyncPlan;
  reserved?: ReservedShortName[];
  details: DeviceDetails;
  onDone?: () => void;
}) {
  const { t, i18n } = useTranslation("drawer");
  const { deviceName } = useDeviceContext();
  const [state, setState] = useState(() => initWizard(plan, reserved));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // Rebuild whenever the dialog opens — the plan is a snapshot of the device,
  // and a stale one would write against files that have since moved.
  useEffect(() => {
    if (open) {
      setState(initWizard(plan, reserved));
      setRunning(false);
      setProgress(0);
    }
    // `plan` / `reserved` are rebuilt by the caller per open; keying on `open`
    // is what makes this a reset rather than a re-init on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trackIssues = useMemo(() => trackProblems(state), [state]);
  const courseIssues = useMemo(() => courseProblems(state), [state]);
  const rows = selectedRows(state);
  const courseRows = selectedCourseRows(state);

  const problemText = useCallback(
    (problem: NameProblem): string => {
      // Keys are literal-union typed, so these must be spelled out rather than
      // built from the problem string.
      switch (problem) {
        case "required":
          return t("deviceTracks.wizard.problemRequired");
        case "still_generated":
          return t("deviceTracks.wizard.problemStillGenerated");
        case "short_required":
          return t("deviceTracks.wizard.problemShortRequired");
        case "short_charset":
          return t("deviceTracks.wizard.problemShortCharset");
        case "short_too_long":
          return t("deviceTracks.wizard.problemShortTooLong");
        case "short_duplicate":
          return t("deviceTracks.wizard.problemShortDuplicate");
      }
    },
    [t],
  );

  const skipText = useCallback(
    (reason: SkipReason, name: string): string => {
      switch (reason) {
        case "mixed_kind":
          return t("deviceTracks.wizard.skippedMixedKind", { name });
        case "too_many_courses":
          return t("deviceTracks.wizard.skippedTooManyCourses", { name });
        case "too_many_bytes":
          return t("deviceTracks.wizard.skippedTooManyBytes", { name });
        case "sprint_unsupported":
          return t("deviceTracks.wizard.skippedSprintUnsupported", { name });
      }
    },
    [t],
  );

  const handleSave = async () => {
    // The device gets the curated subset; the app keeps every course. Without
    // this lookup, accepting the wizard would write them all back and undo the
    // curation the user did in the tracks list (plan 0017).
    const operations = planOperations(resolutions(state), (kind, shortName) =>
      loadTrackOverrides(deviceName, kind, shortName),
    );
    const executors: SyncExecutors = {
      devicePut: (folder, fileName, data) => details.putTrack(fileName, data, folder),
      deviceDelete: (folder, fileName) => details.deleteTrack(fileName, folder),
      appPut: async (track) => void (await saveSyncedTrack(track)),
      appDelete: async (trackName) => void (await deleteAppTrack(trackName)),
    };

    setRunning(true);
    setProgress(0);
    try {
      const result = await runSyncOperations(operations, executors, (p) =>
        setProgress(p.total > 0 ? Math.round((p.done / p.total) * 100) : 0),
      );
      if (result.succeeded.length > 0) {
        toast.success(
          t("deviceTracks.wizard.doneToast", { count: result.succeeded.length }),
        );
      }
      if (result.failed.length > 0) {
        toast.error(
          t("deviceTracks.wizard.partialToast", { count: result.failed.length }),
        );
      }
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(
        t("deviceTracks.wizard.failedToast", {
          error: err instanceof Error ? err.message : t("deviceTracks.unknownError"),
        }),
      );
    } finally {
      setRunning(false);
    }
  };

  const onTracks = state.step === "tracks";

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
        onInteractOutside={(e) => running && e.preventDefault()}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {onTracks
              ? t("deviceTracks.wizard.trackStepTitle")
              : t("deviceTracks.wizard.courseStepTitle")}
          </DialogTitle>
          <DialogDescription className="text-left">
            {onTracks
              ? t("deviceTracks.wizard.trackStepDesc")
              : t("deviceTracks.wizard.courseStepDesc")}
          </DialogDescription>
        </DialogHeader>

        {onTracks ? (
          <div className="space-y-3">
            {state.plan.rows.map((row) => {
              const checked = state.selected.has(row.key);
              const draft = state.trackDrafts[row.key];
              const problem = trackIssues[row.key];
              const walked = parseDeviceGeneratedName(row.name);
              return (
                <div key={row.key} className="space-y-1.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => setState((s) => toggleRow(s, row.key))}
                    className="flex w-full items-center gap-2 text-left text-sm"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "bg-primary border-primary text-primary-foreground" : "border-input"
                      }`}
                    >
                      {checked && <Check className="w-3 h-3" />}
                    </span>
                    <span className="flex flex-1 flex-wrap items-center gap-2">
                      <span className="text-foreground">{row.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${DIRECTION_STYLE[row.direction]}`}
                      >
                        {row.direction === "upload" ? (
                          <Upload className="mr-1 inline h-2.5 w-2.5" />
                        ) : (
                          <Download className="mr-1 inline h-2.5 w-2.5" />
                        )}
                        {row.direction === "upload"
                          ? t("deviceTracks.wizard.upload")
                          : t("deviceTracks.wizard.download")}
                      </span>
                      {row.kind === "sprint" && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                          {t("deviceTracks.sprintBadge")}
                        </span>
                      )}
                    </span>
                  </button>

                  {checked && row.needsRename && draft && (
                    <div className="space-y-1 pl-6">
                      {walked && (
                        <p className="text-xs text-muted-foreground">
                          {t("deviceTracks.wizard.walkedOn", {
                            date: formatWalkedOn(walked, i18n.language),
                          })}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Input
                          value={draft.name}
                          onChange={(e) => setState((s) => setTrackName(s, row.key, e.target.value))}
                          placeholder={t("deviceTracks.wizard.namePlaceholder")}
                          aria-label={t("deviceTracks.wizard.nameLabel")}
                          className="flex-1"
                        />
                        <Input
                          value={draft.shortName}
                          onChange={(e) =>
                            setState((s) => setTrackShortName(s, row.key, e.target.value))
                          }
                          placeholder={t("deviceTracks.wizard.shortNameLabel")}
                          aria-label={t("deviceTracks.wizard.shortNameLabel")}
                          maxLength={8}
                          className="w-24 shrink-0 font-mono uppercase"
                        />
                      </div>
                      {problem && (
                        <p className="text-xs text-destructive">{problemText(problem)}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {state.plan.skipped.length > 0 && (
              <div className="space-y-1 rounded-md bg-warning/10 p-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("deviceTracks.wizard.skippedTitle")}
                </p>
                {state.plan.skipped.map((s) => (
                  <p key={s.key} className="text-xs text-muted-foreground">
                    {skipText(s.reason, s.name)}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {courseRows.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("deviceTracks.noCourses")}</p>
            )}
            {rows.map((row) =>
              row.courses.map((course) => {
                const draft = state.courseDrafts[course.key];
                const problem = courseIssues[course.key];
                const walked = parseDeviceGeneratedName(course.name);
                const trackLabel = state.trackDrafts[row.key]?.name || row.name;
                return (
                  <div key={course.key} className="space-y-1.5">
                    {/* Same shape as a track row: the ORIGINAL name, then the
                        badges, then when it was walked, then the box. */}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-foreground">{course.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          course.kind === "sprint"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {course.kind === "sprint"
                          ? t("deviceTracks.sprintBadge")
                          : t("deviceTracks.wizard.circuitBadge")}
                      </span>
                      {/* Which track this course belongs to — several tracks can
                          be on this screen at once, and a bare course name is
                          ambiguous between them. */}
                      <span className="text-xs text-muted-foreground">{trackLabel}</span>
                    </div>
                    {walked && (
                      <p className="text-xs text-muted-foreground">
                        {t("deviceTracks.wizard.walkedOn", {
                          date: formatWalkedOn(walked, i18n.language),
                        })}
                      </p>
                    )}
                    <Input
                      value={draft?.name ?? course.name}
                      onChange={(e) => setState((s) => setCourseName(s, course.key, e.target.value))}
                      placeholder={t("deviceTracks.wizard.coursePlaceholder")}
                      aria-label={t("deviceTracks.wizard.coursePlaceholder")}
                    />
                    {problem && <p className="text-xs text-destructive">{problemText(problem)}</p>}
                  </div>
                );
              }),
            )}
          </div>
        )}

        {running && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {onTracks ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
                {t("deviceTracks.cancel")}
              </Button>
              <Button onClick={() => setState(goToCourses)} disabled={!canAdvance(state)}>
                {t("deviceTracks.wizard.next")} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setState(goToTracks)} disabled={running}>
                <ArrowLeft className="mr-1 h-4 w-4" /> {t("deviceTracks.wizard.back")}
              </Button>
              <Button onClick={handleSave} disabled={running || !canSave(state)}>
                {running ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("deviceTracks.wizard.saving")}
                  </>
                ) : (
                  t("deviceTracks.wizard.save")
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The yes/no that opens the wizard. Deliberately one question, two buttons. */
export function DeviceSyncPrompt({
  open,
  count,
  onAccept,
  onDecline,
}: {
  open: boolean;
  count: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation("drawer");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDecline()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("deviceTracks.wizard.promptTitle")}</DialogTitle>
          <DialogDescription className="text-left">
            {t("deviceTracks.wizard.promptDesc", { count })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onDecline}>
            {t("deviceTracks.wizard.promptNo")}
          </Button>
          <Button onClick={onAccept}>{t("deviceTracks.wizard.promptYes")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
