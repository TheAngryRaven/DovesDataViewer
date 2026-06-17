import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowLeft, ArrowDown, ArrowUp, Trophy, Car, MapPin, ChevronDown, ChevronUp, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Vehicle } from "@/lib/vehicleStorage";
import { VehicleSetup } from "@/lib/setupStorage";
import { FileMetadata, listAllMetadata } from "@/lib/fileStorage";
import { SetupRevision, shortRevHash } from "@/lib/setupRevision";
import { listSetupRevisions } from "@/lib/setupRevisionStorage";
import { formatLapTime } from "@/lib/lapCalculation";
import {
  buildSetupHistory,
  type SetupField,
  type SetupFieldDiff,
  type SetupHistoryEntry,
} from "@/lib/setupHistory";

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

  return (
    <div
      className={`rounded-lg border p-3 space-y-2.5 ${
        isFastestOverall ? "border-success/60 bg-success/5" : "border-border"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                isOriginal ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {isOriginal ? t("setupHistory.original") : t("setupHistory.revision")}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">#{shortRevHash(revision.id)}</span>
            <span className="text-[10px] text-muted-foreground">{date}</span>
            {isFastestOverall && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-success/15 text-success">
                <Trophy className="w-3 h-3" /> {t("setupHistory.fastestTag")}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {fastestLapMs !== null ? (
            <span className="font-mono text-sm font-semibold text-foreground">{formatLapTime(fastestLapMs)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{t("setupHistory.noLap")}</span>
          )}
        </div>
      </div>

      {/* Bubbles for the fastest usage's kart/course (the dimensions not filtered) */}
      {(((!hideKartBubble && fastestUsage?.kartName) || (!hideCourseBubble && fastestUsage?.courseLabel))) && (
        <div className="flex flex-wrap gap-1">
          {!hideKartBubble && fastestUsage?.kartName && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              <Car className="w-3 h-3" /> {fastestUsage.kartName}
            </span>
          )}
          {!hideCourseBubble && fastestUsage?.courseLabel && (
            <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              <MapPin className="w-3 h-3" /> {fastestUsage.courseLabel}
            </span>
          )}
        </div>
      )}

      {/* Setup content: full table, or diff-only for later revisions */}
      {showFull ? (
        <FullSetup fields={entry.fields} labelFor={labelFor} t={t} />
      ) : diff && diff.length > 0 ? (
        <DiffList diff={diff} labelFor={labelFor} />
      ) : (
        <p className="text-xs text-muted-foreground italic">{t("setupHistory.noChanges")}</p>
      )}

      {/* Full/diff toggle (original is always full) */}
      {!isOriginal && (
        <button
          type="button"
          onClick={onToggleFull}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {showFull ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showFull ? t("setupHistory.showChanges") : t("setupHistory.showFull")}
        </button>
      )}

      {/* Fastest laps completed with this revision */}
      {usages.length > 0 && (
        <div className="pt-1.5 border-t border-border/60 space-y-0.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            {t("setupHistory.lapsHeader")}
          </p>
          {usages.slice(0, 6).map((u) => (
            <div key={u.fileName} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground truncate">
                {[u.courseLabel, u.kartName].filter(Boolean).join(" · ") || u.fileName}
              </span>
              <span className="font-mono text-foreground shrink-0">
                {u.fastestLapMs !== undefined ? formatLapTime(u.fastestLapMs) : t("setupHistory.noLap")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FullSetup({
  fields, labelFor, t,
}: {
  fields: SetupField[];
  labelFor: (f: { label?: string; labelKey?: string }) => string;
  t: TFunction<"drawer">;
}) {
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("setupHistory.noSetupData")}</p>;
  }
  return (
    <div className="space-y-0.5">
      {fields.map((f) => (
        <div key={f.key} className="flex justify-between gap-2 text-xs">
          <span className="text-muted-foreground truncate">{labelFor(f)}</span>
          <span className="font-mono text-foreground shrink-0">
            {f.display}{f.unit ? ` ${f.unit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffList({
  diff, labelFor,
}: {
  diff: SetupFieldDiff[];
  labelFor: (f: { label?: string; labelKey?: string }) => string;
}) {
  return (
    <div className="space-y-0.5">
      {diff.map((d) => {
        const color =
          d.direction === "up" ? "text-success" : d.direction === "down" ? "text-destructive" : "text-foreground";
        const Arrow = d.direction === "up" ? ArrowUp : d.direction === "down" ? ArrowDown : null;
        return (
          <div key={d.key} className="flex justify-between gap-2 text-xs items-center">
            <span className="text-muted-foreground truncate">{labelFor(d)}</span>
            <span className="flex items-center gap-1 font-mono shrink-0">
              {d.prevDisplay !== null && (
                <span className="text-muted-foreground/70 line-through decoration-muted-foreground/40">
                  {d.prevDisplay}
                </span>
              )}
              <span className={`flex items-center gap-0.5 ${color}`}>
                {Arrow && <Arrow className="w-3 h-3" />}
                {d.nextDisplay !== null ? `${d.nextDisplay}${d.unit ? ` ${d.unit}` : ""}` : "—"}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
