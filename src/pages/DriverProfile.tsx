import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Car, Cpu, Trophy, UserX, Weight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { BackToHome } from "@/components/BackToHome";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useSettings } from "@/hooks/useSettings";
import { formatLapTime } from "@/lib/lapCalculation";
import { groupEntriesByCourseWeight, type DriverCourseGroup } from "@/lib/driverProfileGroups";
import { buildLeaderboardSession } from "@/lib/leaderboardSession";
import { setPendingLeaderboardSession } from "@/lib/leaderboardHandoff";
import type { PublicProfile, PublicVehicle } from "@/plugins/cloud-sync/publicProfile";

/** One flattened, clickable uploaded snapshot card. */
interface SnapshotCard {
  id: string;
  courseName: string;
  trackName: string;
  engineLabel: string;
  weightLabel: string | null;
  lapTimeMs: number;
}

/** Flatten the course→weight→lap grouping into one card per uploaded snapshot. */
function flattenSnapshots(courses: DriverCourseGroup[]): SnapshotCard[] {
  return courses.flatMap((c) =>
    c.weightGroups.flatMap((wg) =>
      wg.laps.map((lap) => ({
        id: lap.id,
        courseName: c.courseName,
        trackName: c.trackName,
        engineLabel: lap.engineLabel,
        weightLabel: wg.weightLabel,
        lapTimeMs: lap.lapTimeMs,
      })),
    ),
  );
}

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === "true";

interface LoadedData {
  profile: PublicProfile;
  vehicles: PublicVehicle[];
  courses: DriverCourseGroup[];
}

type LoadState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error"; message: string }
  | { status: "ready"; data: LoadedData };

export default function DriverProfile() {
  const navigate = useNavigate();
  const { username } = useParams<{ username: string }>();
  const name = decodeURIComponent(username ?? "");
  const { t } = useTranslation(["driver", "common"]);
  const { settings, setSettings, toggleFieldDefault } = useSettings();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const { fetchPublicProfileByName, fetchPublicVehicles } = await import(
          "@/plugins/cloud-sync/publicProfile"
        );
        const profile = await fetchPublicProfileByName(name);
        if (cancelled) return;
        if (!profile) {
          setState({ status: "notfound" });
          return;
        }
        const { fetchApprovedLightByUser, fetchEngineClasses } = await import(
          "@/plugins/cloud-sync/leaderboardClient"
        );
        const [entries, classes, vehicles] = await Promise.all([
          fetchApprovedLightByUser(profile.userId),
          fetchEngineClasses(),
          fetchPublicVehicles(profile.userId),
        ]);
        if (cancelled) return;
        setState({
          status: "ready",
          data: { profile, vehicles, courses: groupEntriesByCourseWeight(entries, classes) },
        });
      } catch (e) {
        if (!cancelled) {
          setState({ status: "error", message: e instanceof Error ? e.message : t("loadFailed") });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name, t]);

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

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <BackToHome />

          {state.status === "loading" && (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          )}
          {state.status === "error" && <p className="text-sm text-destructive">{state.message}</p>}
          {state.status === "notfound" && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <UserX className="h-10 w-10 opacity-40" />
              <p className="text-base font-medium text-foreground">{t("notFoundTitle")}</p>
              <p className="text-sm">{t("notFoundBody", { name })}</p>
            </div>
          )}

          {state.status === "ready" && <DriverBody data={state.data} />}
        </div>
      </main>
    </div>
  );
}

function DriverBody({ data }: { data: LoadedData }) {
  const { t } = useTranslation("driver");
  const navigate = useNavigate();
  const { profile, vehicles, courses } = data;
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const snapshots = flattenSnapshots(courses);

  // Open one uploaded snapshot in the read-only viewer — the same hand-off the
  // Leaderboards page uses (fetch the full entry, build a synthetic session, jump).
  const openSnapshot = async (s: SnapshotCard) => {
    setLoadingId(s.id);
    try {
      const { fetchGroupEntries } = await import("@/plugins/cloud-sync/leaderboardClient");
      const full = await fetchGroupEntries([s.id], 1);
      const bundle = buildLeaderboardSession(full, {
        courseName: s.courseName,
        engineLabel: s.engineLabel,
        weightLabel: s.weightLabel ?? undefined,
      });
      if (!bundle) {
        toast.error(t("loadFailed"));
        return;
      }
      setPendingLeaderboardSession(bundle);
      navigate("/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top: avatar + name on the left, public vehicles on the right. */}
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="flex items-center gap-4 md:shrink-0">
          <ProfileAvatar url={profile.avatarUrl} alt={profile.displayName} sizeClassName="h-20 w-20" />
          <h2 className="text-2xl font-bold text-foreground">{profile.displayName}</h2>
        </div>

        <section className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("vehiclesTitle")}
            </h3>
          </div>
          {vehicles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              {t("vehiclesEmpty")}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {vehicles.map((v) => (
                <div key={v.vehicleId} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-sm font-medium text-foreground">
                    {v.number ? `#${v.number} — ` : ""}
                    {v.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {v.typeName ?? t("unknownType")}
                    {v.engine ? ` · ${v.engine}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Below both: uploaded-snapshot cards. Clicking one loads it read-only. */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{t("snapshotsTitle")}</h3>
        </div>
        {snapshots.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("snapshotsEmpty")}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snapshots.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={loadingId === s.id}
                onClick={() => void openSnapshot(s)}
                title={t("openSnapshot")}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{s.courseName}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.trackName}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-sm font-semibold text-primary">
                    {loadingId === s.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {formatLapTime(s.lapTimeMs)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    <Cpu className="h-3 w-3" /> {s.engineLabel}
                  </span>
                  {s.weightLabel && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      <Weight className="h-3 w-3" /> {s.weightLabel}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
