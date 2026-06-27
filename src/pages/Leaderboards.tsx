import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Trophy, Cpu, Hash, Layers } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { formatLapTime } from "@/lib/lapCalculation";
import { buildBrowseTree, type CourseNode, type GroupNode, type TrackNode } from "@/lib/leaderboardBrowse";
import { buildLeaderboardSession } from "@/lib/leaderboardSession";
import { setPendingLeaderboardSession } from "@/lib/leaderboardHandoff";
import type { EngineClass, LeaderboardEntry } from "@/lib/leaderboardTypes";
import { cn } from "@/lib/utils";

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";
const TOP_OPTIONS = [3, 10, 25, 50, 100] as const;
const DEFAULT_TOP = 50;

/** A little data bubble (same visual language used elsewhere in the app). */
function Bubble({ icon: Icon, children }: { icon: typeof Cpu; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

export default function Leaderboards() {
  const navigate = useNavigate();
  const { t } = useTranslation(["leaderboard", "common"]);
  const { settings, setSettings, toggleFieldDefault } = useSettings();

  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [classes, setClasses] = useState<EngineClass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [groupByWeight, setGroupByWeight] = useState(false);
  const [top, setTop] = useState<number | "all">(DEFAULT_TOP);
  const [openTracks, setOpenTracks] = useState<Set<string>>(new Set());
  const [openCourses, setOpenCourses] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchApprovedLight, fetchEngineClasses } = await import("@/plugins/cloud-sync/leaderboardClient");
        const [light, cls] = await Promise.all([fetchApprovedLight(), fetchEngineClasses()]);
        if (cancelled) return;
        setEntries(light);
        setClasses(cls);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  const tree = useMemo(
    () => (entries ? buildBrowseTree(entries, classes, groupByWeight) : []),
    [entries, classes, groupByWeight],
  );

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  // Build + hand off a read-only session from a set of entry ids (one lap, or the
  // top-N of a group), then jump to the viewer.
  const loadSession = useCallback(
    async (course: CourseNode, group: GroupNode, ids: string[], limit: number | null, loadingKey: string) => {
      setLoadingKey(loadingKey);
      try {
        const { fetchGroupEntries } = await import("@/plugins/cloud-sync/leaderboardClient");
        const full = await fetchGroupEntries(ids, limit);
        const bundle = buildLeaderboardSession(full, {
          courseName: course.courseName,
          engineLabel: group.engineLabel,
          weightLabel: group.weightLabel,
        });
        if (!bundle) {
          toast.error(t("buildFailed"));
          return;
        }
        setPendingLeaderboardSession(bundle);
        navigate("/");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("buildFailed"));
      } finally {
        setLoadingKey(null);
      }
    },
    [navigate, t],
  );

  const openTopSession = useCallback(
    (course: CourseNode, group: GroupNode) =>
      loadSession(course, group, group.entryIds, top === "all" ? null : top, `top:${group.key}`),
    [loadSession, top],
  );

  const openSingle = useCallback(
    (course: CourseNode, group: GroupNode, entryId: string) =>
      loadSession(course, group, [entryId], 1, `one:${entryId}`),
    [loadSession],
  );

  const settingsButton = (
    <SettingsModal
      settings={settings}
      onSettingsChange={setSettings}
      onToggleFieldDefault={toggleFieldDefault}
      canHideSampleFiles
      triggerLabelBreakpoint="sm"
    />
  );

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-x">
      <SiteHeader
        settingsButton={settingsButton}
        enableCloud={enableCloud}
        onOpenProfile={() => navigate("/", { state: { openProfile: true } })}
        showSupportedFiles={false}
        showAbout={false}
      />

      <main className="flex-1 px-6 py-8">
        <div className="mx-auto w-full max-w-4xl space-y-5">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-2xl font-bold text-foreground">{t("title")}</h2>
              <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id="gbw" checked={groupByWeight} onCheckedChange={setGroupByWeight} />
              <Label htmlFor="gbw" className="text-sm text-muted-foreground">{t("groupByWeight")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("showTop")}</span>
              <Select value={String(top)} onValueChange={(v) => setTop(v === "all" ? "all" : Number(v))}>
                <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TOP_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                  <SelectItem value="all">{t("all")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {!entries && !error && <p className="text-sm text-muted-foreground">{t("loading")}</p>}
          {entries && tree.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              {t("empty")}
            </div>
          )}

          <div className="space-y-2">
            {tree.map((track) => (
              <TrackRow
                key={track.trackName}
                track={track}
                open={openTracks.has(track.trackName)}
                onToggle={() => toggle(openTracks, track.trackName, setOpenTracks)}
                openCourses={openCourses}
                onToggleCourse={(ck) => toggle(openCourses, ck, setOpenCourses)}
                openGroups={openGroups}
                onToggleGroup={(gk) => toggle(openGroups, gk, setOpenGroups)}
                onOpenTopSession={openTopSession}
                onOpenSingle={openSingle}
                top={top}
                loadingKey={loadingKey}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function TrackRow({
  track, open, onToggle, openCourses, onToggleCourse, openGroups, onToggleGroup,
  onOpenTopSession, onOpenSingle, top, loadingKey,
}: {
  track: TrackNode;
  open: boolean;
  onToggle: () => void;
  openCourses: Set<string>;
  onToggleCourse: (courseKey: string) => void;
  openGroups: Set<string>;
  onToggleGroup: (groupKey: string) => void;
  onOpenTopSession: (course: CourseNode, group: GroupNode) => void;
  onOpenSingle: (course: CourseNode, group: GroupNode, entryId: string) => void;
  top: number | "all";
  loadingKey: string | null;
}) {
  const { t } = useTranslation("leaderboard");
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="flex-1 font-semibold text-foreground">{track.trackName}</span>
        <span className="flex flex-wrap gap-1.5">
          <Bubble icon={Cpu}>{t("bubbles.engines", { count: track.engineCount })}</Bubble>
          <Bubble icon={Hash}>{t("bubbles.records", { count: track.recordCount })}</Bubble>
          <Bubble icon={Trophy}>{t("bubbles.fastest", { time: formatLapTime(track.fastestMs) })}</Bubble>
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-2 py-2 space-y-1.5">
          {track.courses.map((course) => {
            const courseOpen = openCourses.has(course.courseKey);
            return (
              <div key={course.courseKey} className="rounded-md border border-border/60">
                <button
                  type="button"
                  onClick={() => onToggleCourse(course.courseKey)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
                >
                  <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", courseOpen && "rotate-90")} />
                  <span className="flex-1 text-sm font-medium text-foreground">{course.courseName}</span>
                  <span className="flex flex-wrap gap-1.5">
                    <Bubble icon={Cpu}>{t("bubbles.engines", { count: course.engineCount })}</Bubble>
                    <Bubble icon={Hash}>{t("bubbles.records", { count: course.recordCount })}</Bubble>
                    <Bubble icon={Trophy}>{t("bubbles.fastest", { time: formatLapTime(course.fastestMs) })}</Bubble>
                  </span>
                </button>

                {courseOpen && (
                  <div className="border-t border-border/60 px-2 py-1.5 space-y-1">
                    {course.groups.map((group) => {
                      const groupKey = `${course.courseKey}|${group.key}`;
                      const groupOpen = openGroups.has(groupKey);
                      const topN = top === "all" ? group.recordCount : Math.min(top, group.recordCount);
                      return (
                        <div key={group.key} className="rounded border border-border/50">
                          <button
                            type="button"
                            onClick={() => onToggleGroup(groupKey)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-primary/10"
                          >
                            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", groupOpen && "rotate-90")} />
                            <span className="flex-1 text-foreground">{group.label}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatLapTime(group.fastestMs)}
                            </span>
                            <Bubble icon={Hash}>{t("bubbles.records", { count: group.recordCount })}</Bubble>
                          </button>

                          {groupOpen && (
                            <div className="border-t border-border/50 px-2 py-1.5 space-y-1">
                              {group.recordCount > 1 && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="w-full h-8 justify-center gap-1.5"
                                  disabled={loadingKey === `top:${group.key}`}
                                  onClick={() => onOpenTopSession(course, group)}
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                  {top === "all"
                                    ? t("loadAllSession")
                                    : t("loadTopSession", { count: topN })}
                                </Button>
                              )}
                              {group.entries.map((entry, i) => (
                                <button
                                  key={entry.id}
                                  type="button"
                                  disabled={loadingKey === `one:${entry.id}`}
                                  onClick={() => onOpenSingle(course, group, entry.id)}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-primary/10 disabled:opacity-60"
                                >
                                  <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
                                  <span className="flex-1 truncate text-foreground">{entry.displayName}</span>
                                  <span className="font-mono text-xs text-muted-foreground">{formatLapTime(entry.lapTimeMs)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
