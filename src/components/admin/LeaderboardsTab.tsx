import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatLapTime } from "@/lib/lapCalculation";
import type { EngineClass, LeaderboardEntry } from "@/lib/leaderboardTypes";
import {
  fetchAllEntriesAdmin, updateEntryAdmin, reclassifyEntries,
  createEngineClass, updateEngineClass, deleteEngineClass,
} from "@/plugins/cloud-sync/leaderboardClient";
import { fetchEngineClasses } from "@/plugins/cloud-sync/leaderboardClient";

type StatusFilter = "all" | "approved" | "denied";
const UNCLASSIFIED = "__none__";

export function LeaderboardsTab() {
  const { t } = useTranslation("admin");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [classes, setClasses] = useState<EngineClass[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const classesById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const refresh = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([fetchAllEntriesAdmin(), fetchEngineClasses()]);
      setEntries(e);
      setClasses(c);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("leaderboards.loadFailed"));
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const patch = async (id: string, p: Parameters<typeof updateEntryAdmin>[1]) => {
    setBusy(id);
    try {
      await updateEntryAdmin(id, p);
      toast.success(t("leaderboards.updated"));
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("leaderboards.updateFailed"));
    } finally {
      setBusy(null);
    }
  };

  const visible = useMemo(
    () => (entries ?? []).filter((e) => filter === "all" || e.status === filter),
    [entries, filter],
  );

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!entries) return <p className="text-sm text-muted-foreground">{t("leaderboards.loading")}</p>;

  return (
    <div className="space-y-8">
      <EngineClassesEditor classes={classes} onChanged={refresh} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("leaderboards.title")}</h3>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("leaderboards.filterAll")}</SelectItem>
              <SelectItem value="approved">{t("leaderboards.filterApproved")}</SelectItem>
              <SelectItem value="denied">{t("leaderboards.filterDenied")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leaderboards.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-2">{t("leaderboards.colDriver")}</th>
                  <th className="px-2 py-2">{t("leaderboards.colTrack")}</th>
                  <th className="px-2 py-2">{t("leaderboards.colEngine")}</th>
                  <th className="px-2 py-2">{t("leaderboards.colClass")}</th>
                  <th className="px-2 py-2">{t("leaderboards.colWeight")}</th>
                  <th className="px-2 py-2">{t("leaderboards.colTime")}</th>
                  <th className="px-2 py-2">{t("leaderboards.colStatus")}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2">{e.displayName}</td>
                    <td className="px-2 py-2 text-muted-foreground">{e.trackName}<br />{e.courseName}</td>
                    <td className="px-2 py-2">{e.engine}</td>
                    <td className="px-2 py-2">
                      <Select
                        value={e.engineClassId ?? UNCLASSIFIED}
                        onValueChange={(v) => patch(e.id, { engineClassId: v === UNCLASSIFIED ? null : v })}
                      >
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNCLASSIFIED}>{t("leaderboards.unclassified")}</SelectItem>
                          {classes.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {e.listedWeight != null ? `${e.listedWeight} ${e.listedWeightUnit ?? ""}` : "—"}
                    </td>
                    <td className="px-2 py-2 font-mono whitespace-nowrap">{formatLapTime(e.lapTimeMs)}</td>
                    <td className="px-2 py-2">
                      <span className={e.status === "denied" ? "text-destructive" : "text-green-600"}>{e.status}</span>
                    </td>
                    <td className="px-2 py-2">
                      {e.status === "approved" ? (
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === e.id} onClick={() => patch(e.id, { status: "denied" })}>
                          {t("leaderboards.deny")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === e.id} onClick={() => patch(e.id, { status: "approved" })}>
                          {t("leaderboards.approve")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Engine-class keyword groups + a reclassify trigger. */
function EngineClassesEditor({ classes, onChanged }: { classes: EngineClass[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation("admin");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);

  const parseKeywords = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createEngineClass(name.trim(), parseKeywords(keywords), classes.length);
      setName(""); setKeywords("");
      toast.success(t("leaderboards.classSaved"));
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("leaderboards.classFailed"));
    } finally {
      setBusy(false);
    }
  };

  const reclassify = async () => {
    setBusy(true);
    try {
      const n = await reclassifyEntries();
      toast.success(t("leaderboards.reclassified", { count: n }));
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("leaderboards.classFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("leaderboards.classesTitle")}</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void reclassify()}>
          {t("leaderboards.reclassify")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("leaderboards.classesHint")}</p>

      <div className="space-y-2">
        {classes.map((c) => (
          <EngineClassRow key={c.id} cls={c} onChanged={onChanged} />
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div className="flex-1 min-w-[140px]">
          <label className="text-xs text-muted-foreground">{t("leaderboards.className")}</label>
          <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("leaderboards.classNamePlaceholder")} />
        </div>
        <div className="flex-[2] min-w-[180px]">
          <label className="text-xs text-muted-foreground">{t("leaderboards.keywords")}</label>
          <Input className="h-8" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={t("leaderboards.keywordsPlaceholder")} />
        </div>
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => void add()}>{t("leaderboards.addClass")}</Button>
      </div>
    </div>
  );
}

function EngineClassRow({ cls, onChanged }: { cls: EngineClass; onChanged: () => Promise<void> }) {
  const { t } = useTranslation("admin");
  const [name, setName] = useState(cls.name);
  const [keywords, setKeywords] = useState(cls.keywords.join(", "));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateEngineClass(cls.id, { name: name.trim(), keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) });
      toast.success(t("leaderboards.classSaved"));
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("leaderboards.classFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteEngineClass(cls.id);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("leaderboards.classFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input className="h-8 flex-1 min-w-[120px]" value={name} onChange={(e) => setName(e.target.value)} />
      <Input className="h-8 flex-[2] min-w-[160px]" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void save()}>{t("leaderboards.saveClass")}</Button>
      <Button size="sm" variant="ghost" className="h-8 text-destructive" disabled={busy} onClick={() => void remove()}>{t("leaderboards.deleteClass")}</Button>
    </div>
  );
}
