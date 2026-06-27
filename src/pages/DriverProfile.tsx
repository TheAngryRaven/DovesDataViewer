import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Car, Trophy, UserX } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SettingsModal } from "@/components/SettingsModal";
import { BackToHome } from "@/components/BackToHome";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useSettings } from "@/hooks/useSettings";
import { formatLapTime } from "@/lib/lapCalculation";
import { groupEntriesByCourseWeight, type DriverCourseGroup } from "@/lib/driverProfileGroups";
import type { PublicProfile, PublicVehicle } from "@/plugins/cloud-sync/publicProfile";

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
  const { profile, vehicles, courses } = data;

  return (
    <div className="space-y-8">
      {/* Header: avatar + name */}
      <div className="flex items-center gap-4">
        <ProfileAvatar url={profile.avatarUrl} alt={profile.displayName} sizeClassName="h-16 w-16" />
        <h2 className="text-2xl font-bold text-foreground">{profile.displayName}</h2>
      </div>

      {/* Vehicles (no weights, no setups) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{t("vehiclesTitle")}</h3>
        </div>
        {vehicles.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
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

      {/* Uploaded leaderboard snapshots, by course + weight */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{t("snapshotsTitle")}</h3>
        </div>
        {courses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("snapshotsEmpty")}
          </p>
        ) : (
          <div className="space-y-3">
            {courses.map((course) => (
              <div key={course.courseKey} className="rounded-lg border border-border">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{course.courseName}</p>
                    <p className="truncate text-xs text-muted-foreground">{course.trackName}</p>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatLapTime(course.fastestMs)}
                  </span>
                </div>
                <div className="space-y-2 px-2 py-2">
                  {course.weightGroups.map((wg) => (
                    <div key={wg.key} className="rounded-md border border-border/60">
                      <div className="border-b border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        {wg.weightLabel ?? t("noWeight")}
                      </div>
                      <div className="px-2 py-1.5 space-y-1">
                        {wg.laps.map((lap, i) => (
                          <div
                            key={lap.id}
                            className="flex items-center gap-2 rounded px-2 py-1 text-sm"
                          >
                            <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">
                              {i + 1}
                            </span>
                            <span className="flex-1 truncate text-foreground">{lap.engineLabel}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatLapTime(lap.lapTimeMs)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
