import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { FileMetadata, listAllMetadata } from "@/lib/fileStorage";
import { SetupRevision, shortRevHash } from "@/lib/setupRevision";
import { listSetupRevisions } from "@/lib/setupRevisionStorage";
import { buildSetupHistory, type SetupHistoryEntry } from "@/lib/setupHistory";
import { HistoryCard, FullSetup, DiffList } from "@/components/drawer/HistoryCard";

interface SetupHistoryPanelProps {
  setup: VehicleSetup;
  vehicles: Vehicle[];
  onBack: () => void;
}

/** Full-panel chronological history of a setup's frozen revisions. */
export function SetupHistoryPanel({ setup, vehicles, onBack }: SetupHistoryPanelProps) {
  const { t } = useTranslation("drawer");
  const [revisions, setRevisions] = useState<SetupRevision[]>([]);
  const [metas, setMetas] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [kartFilter, setKartFilter] = useState<string>("");
  const [courseFilter, setCourseFilter] = useState<string>("");
  // Per-revision override: show the full setup instead of the default diff view.
  const [fullOpen, setFullOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [revs, m] = await Promise.all([listSetupRevisions(), listAllMetadata()]);
      if (!cancelled) {
        setRevisions(revs);
        setMetas(m);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const history = useMemo(
    () =>
      buildSetupHistory({
        setupId: setup.id,
        setupName: setup.name,
        revisions,
        metas,
        vehicles,
        filter: { kartId: kartFilter || null, courseKey: courseFilter || null },
      }),
    [setup.id, setup.name, revisions, metas, vehicles, kartFilter, courseFilter],
  );

  const labelFor = (f: { label?: string; labelKey?: string }): string =>
    f.label ?? (f.labelKey ? t(f.labelKey as never) : "");

  const hasFilters = history.kartOptions.length > 0 || history.courseOptions.length > 0;

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

      {/* Filters */}
      {hasFilters && (
        <div className="shrink-0 flex gap-2 px-3 py-2 border-b border-border">
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
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <p className="text-center text-xs text-muted-foreground py-8">{t("setupHistory.loading")}</p>
        ) : history.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground gap-3 py-16">
            <History className="w-12 h-12 opacity-30" />
            <p className="text-sm font-medium">{t("setupHistory.empty")}</p>
            <p className="text-xs text-center">{t("setupHistory.emptyHint")}</p>
          </div>
        ) : (
          history.entries.map((entry, i) => (
            <RevisionCard
              key={entry.revision.id}
              entry={entry}
              isOriginal={i === 0}
              showFull={i === 0 || !!fullOpen[entry.revision.id]}
              onToggleFull={() =>
                setFullOpen((prev) => ({ ...prev, [entry.revision.id]: !prev[entry.revision.id] }))
              }
              hideKartBubble={!!kartFilter}
              hideCourseBubble={!!courseFilter}
              labelFor={labelFor}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface RevisionCardProps {
  entry: SetupHistoryEntry;
  isOriginal: boolean;
  showFull: boolean;
  onToggleFull: () => void;
  hideKartBubble: boolean;
  hideCourseBubble: boolean;
  labelFor: (f: { label?: string; labelKey?: string }) => string;
  t: TFunction<"drawer">;
}

function RevisionCard({
  entry, isOriginal, showFull, onToggleFull, hideKartBubble, hideCourseBubble, labelFor, t,
}: RevisionCardProps) {
  const { revision, fastestLapMs, fastestUsage, isFastestOverall, diff, usages } = entry;
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
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            isOriginal ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {isOriginal ? t("setupHistory.original") : t("setupHistory.revision")}
        </span>
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
    >
      {body}
    </HistoryCard>
  );
}
