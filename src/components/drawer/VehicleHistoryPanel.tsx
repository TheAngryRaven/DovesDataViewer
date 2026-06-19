import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Vehicle } from "@/lib/vehicleStorage";
import { FileMetadata, listAllMetadata } from "@/lib/fileStorage";
import { SetupRevision, shortRevHash } from "@/lib/setupRevision";
import { listSetupRevisions } from "@/lib/setupRevisionStorage";
import { buildVehicleHistory } from "@/lib/vehicleHistory";
import { HistoryCard, FullSetup } from "@/components/drawer/HistoryCard";

interface VehicleHistoryPanelProps {
  vehicle: Vehicle;
  vehicles: Vehicle[];
  onBack: () => void;
}

/** Full-panel history of every setup revision run on one vehicle, fastest first. */
export function VehicleHistoryPanel({ vehicle, vehicles, onBack }: VehicleHistoryPanelProps) {
  const { t } = useTranslation("drawer");
  const [revisions, setRevisions] = useState<SetupRevision[]>([]);
  const [metas, setMetas] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [courseFilter, setCourseFilter] = useState<string>("");
  // Each card is collapsed by default; expanded ids are tracked here.
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});

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
      buildVehicleHistory({
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        revisions,
        metas,
        vehicles,
        filter: { courseKey: courseFilter || null },
      }),
    [vehicle.id, vehicle.name, revisions, metas, vehicles, courseFilter],
  );

  const labelFor = (f: { label?: string; labelKey?: string }): string =>
    f.label ?? (f.labelKey ? t(f.labelKey as never) : "");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <History className="w-4 h-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold text-foreground truncate">{t("vehicleHistory.title")}</h3>
        </div>
        <span className="text-xs text-muted-foreground truncate max-w-[40%]">{vehicle.name}</span>
      </div>

      {/* Course filter */}
      {history.courseOptions.length > 0 && (
        <div className="shrink-0 flex gap-2 px-3 py-2 border-b border-border">
          <Select value={courseFilter || "__all__"} onValueChange={(v) => setCourseFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder={t("vehicleHistory.allCourses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("vehicleHistory.allCourses")}</SelectItem>
              {history.courseOptions.map((c) => (
                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <p className="text-center text-xs text-muted-foreground py-8">{t("vehicleHistory.loading")}</p>
        ) : history.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground gap-3 py-16">
            <History className="w-12 h-12 opacity-30" />
            <p className="text-sm font-medium">{t("vehicleHistory.empty")}</p>
            <p className="text-xs text-center">{t("vehicleHistory.emptyHint")}</p>
          </div>
        ) : (
          history.entries.map((entry) => {
            const expanded = !!openCards[entry.revision.id];
            return (
              <HistoryCard
                key={entry.revision.id}
                isFastestOverall={entry.isFastestOverall}
                header={
                  <span className="text-xs font-semibold text-foreground truncate max-w-[12rem]">
                    {entry.setupName}
                  </span>
                }
                hash={shortRevHash(entry.revision.id)}
                date={new Date(entry.revision.createdAt).toLocaleDateString()}
                fastestLapMs={entry.fastestLapMs}
                fastestTagLabel={t("vehicleHistory.fastestTag")}
                noLapLabel={t("vehicleHistory.noLap")}
                bubbles={
                  !courseFilter && entry.fastestUsage?.courseLabel
                    ? [{ icon: "map", text: entry.fastestUsage.courseLabel }]
                    : []
                }
                toggle={{
                  expanded,
                  onToggle: () =>
                    setOpenCards((prev) => ({ ...prev, [entry.revision.id]: !prev[entry.revision.id] })),
                  expandLabel: t("vehicleHistory.showFull"),
                  collapseLabel: t("vehicleHistory.hideFull"),
                }}
                usages={entry.usages}
                lapsHeaderLabel={t("vehicleHistory.lapsHeader")}
              >
                {expanded && (
                  <FullSetup
                    fields={entry.fields}
                    labelFor={labelFor}
                    noDataLabel={t("vehicleHistory.noSetupData")}
                  />
                )}
              </HistoryCard>
            );
          })
        )}
      </div>
    </div>
  );
}
