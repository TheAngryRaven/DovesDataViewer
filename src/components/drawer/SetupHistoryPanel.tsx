import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowLeft, Check, Copy, History, Info, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { FileMetadata, listAllMetadata } from "@/lib/fileStorage";
import { REVISION_RETENTION_MS, SetupRevision, shortRevHash } from "@/lib/setupRevision";
import { listSetupRevisions, pruneSetupRevisionsSafely } from "@/lib/setupRevisionStorage";
import { buildSetupHistory, type SetupHistoryEntry, type SetupHistoryView } from "@/lib/setupHistory";
import { HistoryCard, FullSetup, DiffList } from "@/components/drawer/HistoryCard";

interface SetupHistoryPanelProps {
  setup: VehicleSetup;
  vehicles: Vehicle[];
  onBack: () => void;
  /** Open a saved session by file name (a card's fastest-lap session). */
  onOpenFile?: (fileName: string) => void | Promise<void>;
  /** The hash the live setup would freeze to now — rollback is offered only when it drifted. */
  currentHash?: string | null;
  /** Reset the live setup to this revision's values (plan 0028). */
  onRollback?: (revision: SetupRevision) => Promise<void>;
  /** Create a new setup carrying a copy of this revision's values (plan 0028). */
  onDuplicate?: (revision: SetupRevision) => Promise<void>;
}

const RETENTION_DAYS = Math.round(REVISION_RETENTION_MS / (24 * 60 * 60 * 1000));

/** Full-panel chronological history of a setup's frozen revisions. */
export function SetupHistoryPanel({
  setup, vehicles, onBack, onOpenFile, currentHash, onRollback, onDuplicate,
}: SetupHistoryPanelProps) {
  const { t } = useTranslation("drawer");
  const [revisions, setRevisions] = useState<SetupRevision[]>([]);
  const [metas, setMetas] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [kartFilter, setKartFilter] = useState<string>("");
  const [courseFilter, setCourseFilter] = useState<string>("");
  // "used" = revisions a session ran (the default); "all" = every saved revision.
  const [view, setView] = useState<SetupHistoryView>("used");
  // Per-revision override: show the full setup instead of the default diff view.
  const [fullOpen, setFullOpen] = useState<Record<string, boolean>>({});
  // Revision awaiting rollback confirmation.
  const [rollbackTarget, setRollbackTarget] = useState<SetupRevision | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Sweep first so the panel always matches the retention notice it shows.
    await pruneSetupRevisionsSafely();
    const [revs, m] = await Promise.all([listSetupRevisions(), listAllMetadata()]);
    return { revs, m };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then(({ revs, m }) => {
      if (cancelled) return;
      setRevisions(revs);
      setMetas(m);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Rollback / duplicate both save a setup (which freezes a revision), so the
  // list is reloaded afterwards to show the result.
  const runAction = useCallback(
    async (action: () => Promise<void>, done: string) => {
      setBusy(true);
      try {
        await action();
        const { revs, m } = await load();
        setRevisions(revs);
        setMetas(m);
        toast.success(done);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const confirmRollback = () => {
    const target = rollbackTarget;
    if (!target || !onRollback) return;
    setRollbackTarget(null);
    void runAction(() => onRollback(target), t("setupHistory.rollbackDone", { hash: shortRevHash(target.id) }));
  };

  const duplicate = (revision: SetupRevision) => {
    if (!onDuplicate) return;
    const name = t("setupHistory.duplicateName", { name: revision.name });
    void runAction(() => onDuplicate(revision), t("setupHistory.duplicateDone", { name }));
  };

  const history = useMemo(
    () =>
      buildSetupHistory({
        setupId: setup.id,
        setupName: setup.name,
        revisions,
        metas,
        vehicles,
        filter: { kartId: kartFilter || null, courseKey: courseFilter || null, view },
      }),
    [setup.id, setup.name, revisions, metas, vehicles, kartFilter, courseFilter, view],
  );

  const labelFor = (f: { label?: string; labelKey?: string }): string =>
    f.label ?? (f.labelKey ? t(f.labelKey as never) : "");

  // Nothing was run yet but edits exist — point at the "All" view instead of the
  // generic "assign a setup" hint.
  const emptyHint =
    view === "used" && history.totalCount > 0 ? t("setupHistory.emptyUsedHint") : t("setupHistory.emptyHint");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <History className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold text-foreground truncate">{t("setupHistory.title")}</h3>
        </div>
        <span className="text-xs text-muted-foreground truncate max-w-[40%]">{setup.name}</span>
      </div>

      {/* View + filters */}
      <div className="shrink-0 flex flex-wrap gap-2 px-3 py-2 border-b border-border">
        <div
          role="group"
          aria-label={t("setupHistory.viewLabel")}
          className="flex h-8 shrink-0 rounded-md border border-input overflow-hidden text-xs"
        >
          <ViewButton active={view === "used"} onClick={() => setView("used")}>
            {t("setupHistory.viewUsed")} ({history.usedCount})
          </ViewButton>
          <ViewButton active={view === "all"} onClick={() => setView("all")}>
            {t("setupHistory.viewAll")} ({history.totalCount})
          </ViewButton>
        </div>
        {history.kartOptions.length > 0 && (
          <Select value={kartFilter || "__all__"} onValueChange={(v) => setKartFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder={t("setupHistory.allKarts")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("setupHistory.allKarts")}</SelectItem>
              {history.kartOptions.map((k) => (
                <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {history.courseOptions.length > 0 && (
          <Select value={courseFilter || "__all__"} onValueChange={(v) => setCourseFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder={t("setupHistory.allCourses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("setupHistory.allCourses")}</SelectItem>
              {history.courseOptions.map((c) => (
                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {view === "all" && (
        <p className="shrink-0 flex items-start gap-1.5 px-3 py-2 text-[11px] text-muted-foreground border-b border-border">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{t("setupHistory.retentionNotice", { days: RETENTION_DAYS })}</span>
        </p>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <p className="text-center text-xs text-muted-foreground py-8">{t("setupHistory.loading")}</p>
        ) : history.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground gap-3 py-16">
            <History className="w-12 h-12 opacity-30" />
            <p className="text-sm font-medium">{t("setupHistory.empty")}</p>
            <p className="text-xs text-center">{emptyHint}</p>
          </div>
        ) : (
          // Newest on top; the original sits at the bottom and each card above
          // it diffs against the one below (the model stays oldest-first).
          [...history.entries].reverse().map((entry) => (
            <RevisionCard
              key={entry.revision.id}
              entry={entry}
              isOriginal={entry.diff === null}
              showFull={entry.diff === null || !!fullOpen[entry.revision.id]}
              onToggleFull={() =>
                setFullOpen((prev) => ({ ...prev, [entry.revision.id]: !prev[entry.revision.id] }))
              }
              hideKartBubble={!!kartFilter}
              hideCourseBubble={!!courseFilter}
              showUsedTag={view === "all"}
              labelFor={labelFor}
              onOpenFile={onOpenFile}
              // Rollback: only the last revision that ran, and only once the live
              // setup drifted from it. Duplicate: any revision that ran.
              onRollback={
                onRollback &&
                entry.revision.id === history.latestReferencedId &&
                currentHash !== entry.revision.id
                  ? () => setRollbackTarget(entry.revision)
                  : undefined
              }
              onDuplicate={onDuplicate && entry.referenced ? () => duplicate(entry.revision) : undefined}
              busy={busy}
              t={t}
            />
          ))
        )}
      </div>

      <Dialog open={rollbackTarget !== null} onOpenChange={(open) => { if (!open) setRollbackTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("setupHistory.rollbackTitle")}</DialogTitle>
            {rollbackTarget && (
              <DialogDescription>
                {t("setupHistory.rollbackBody", {
                  setup: setup.name,
                  date: new Date(rollbackTarget.createdAt).toLocaleDateString(),
                  hash: shortRevHash(rollbackTarget.id),
                  days: RETENTION_DAYS,
                })}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackTarget(null)}>{t("setups.cancel")}</Button>
            <Button onClick={confirmRollback}>
              <RotateCcw className="w-4 h-4 mr-1.5" /> {t("setupHistory.rollback")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ViewButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

/** One half of the Used/All segmented control. */
function ViewButton({ active, onClick, children }: ViewButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`px-2.5 font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

interface RevisionCardProps {
  entry: SetupHistoryEntry;
  isOriginal: boolean;
  showFull: boolean;
  onToggleFull: () => void;
  hideKartBubble: boolean;
  hideCourseBubble: boolean;
  /** In the "all" view, mark revisions a session ran. */
  showUsedTag: boolean;
  labelFor: (f: { label?: string; labelKey?: string }) => string;
  onOpenFile?: (fileName: string) => void | Promise<void>;
  /** Present only on the card eligible for rollback. */
  onRollback?: () => void;
  /** Present on every card a session ran. */
  onDuplicate?: () => void;
  busy: boolean;
  t: TFunction<"drawer">;
}

function RevisionCard({
  entry, isOriginal, showFull, onToggleFull, hideKartBubble, hideCourseBubble, showUsedTag, labelFor, onOpenFile,
  onRollback, onDuplicate, busy, t,
}: RevisionCardProps) {
  const { revision, fastestLapMs, fastestUsage, isFastestOverall, diff, usages, used } = entry;
  const date = new Date(revision.createdAt).toLocaleDateString();

  const body = showFull ? (
    <FullSetup fields={entry.fields} labelFor={labelFor} noDataLabel={t("setupHistory.noSetupData")} />
  ) : diff && diff.length > 0 ? (
    <DiffList diff={diff} labelFor={labelFor} />
  ) : (
    <p className="text-xs text-muted-foreground italic">{t("setupHistory.noChanges")}</p>
  );

  return (
    <HistoryCard
      isFastestOverall={isFastestOverall}
      header={
        <>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              isOriginal ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {isOriginal ? t("setupHistory.original") : t("setupHistory.revision")}
          </span>
          {showUsedTag && used && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              <Check className="w-3 h-3" /> {t("setupHistory.usedTag")}
            </span>
          )}
        </>
      }
      hash={shortRevHash(revision.id)}
      date={date}
      fastestLapMs={fastestLapMs}
      fastestTagLabel={t("setupHistory.fastestTag")}
      noLapLabel={t("setupHistory.noLap")}
      bubbles={[
        ...(!hideKartBubble && fastestUsage?.kartName ? [{ icon: "car" as const, text: fastestUsage.kartName }] : []),
        ...(!hideCourseBubble && fastestUsage?.courseLabel ? [{ icon: "map" as const, text: fastestUsage.courseLabel }] : []),
      ]}
      toggle={
        isOriginal
          ? undefined
          : {
              expanded: showFull,
              onToggle: onToggleFull,
              expandLabel: t("setupHistory.showFull"),
              collapseLabel: t("setupHistory.showChanges"),
            }
      }
      usages={usages}
      lapsHeaderLabel={t("setupHistory.lapsHeader")}
      onOpenFile={onOpenFile}
      fastestFileName={fastestUsage?.fileName}
      openSessionLabel={t("setupHistory.openSession")}
      actions={
        onRollback || onDuplicate ? (
          <>
            {onRollback && (
              <Button size="sm" variant="default" className="h-7 text-xs gap-1" disabled={busy} onClick={onRollback}>
                <RotateCcw className="w-3.5 h-3.5" /> {t("setupHistory.rollback")}
              </Button>
            )}
            {onDuplicate && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={onDuplicate}>
                <Copy className="w-3.5 h-3.5" /> {t("setupHistory.duplicate")}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {body}
    </HistoryCard>
  );
}
