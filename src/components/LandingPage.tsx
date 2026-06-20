import { Fragment, lazy, Suspense } from "react";
import {
  Gauge,
  Github,
  Heart,
  Shield,
  Play,
  LogIn,
  LogOut,
  FileText,
  Cpu,
  FolderOpen,
  Map,
  Bluetooth,
  Route,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FileImport } from "@/components/FileImport";
import { ActionTile } from "@/components/ActionTile";
import { TrackEditor } from "@/components/TrackEditor";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
import { BrowserCompatDialog } from "@/components/BrowserCompatDialog";
import { ContactDialog } from "@/components/ContactDialog";
import { SupportedFilesDialog } from "@/components/SupportedFilesDialog";
import { AboutDialog } from "@/components/AboutDialog";
import { CreditsDialog } from "@/components/CreditsDialog";
import { PluginMount } from "@/plugins/PluginMount";
import { MountSlot } from "@/plugins/mounts";
import { useAuth } from "@/contexts/AuthContext";
import { buildInfo, formatBuildLabel, commitUrl, isPreviewBuild } from "@/lib/buildInfo";
import { interceptExternal } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { ParsedData } from "@/types/racing";

// Lazy so the BLE module (Web Bluetooth protocol) stays out of the initial
// bundle — it only loads when this tile mounts on the landing page.
const DataloggerDownload = lazy(() =>
  import("./DataloggerDownload").then((m) => ({ default: m.DataloggerDownload })),
);

interface LandingPageProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  onOpenFileManager: () => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
  onLoadSample: () => void;
  isLoadingSample: boolean;
  /** When false, the sample log is hidden everywhere — including this tile. */
  showSampleFiles: boolean;
  enableAdmin: boolean;
  enableCloud: boolean;
}

const GITHUB_LINKS: Array<{ href: string; label: string }> = [
  { href: "https://github.com/TheAngryRaven/DovesDataViewer", label: "DataViewer" },
  { href: "https://github.com/TheAngryRaven/DovesDataLogger", label: "Datalogger" },
  { href: "https://github.com/TheAngryRaven/DovesLapTimer", label: "Timer Library" },
  { href: "https://github.com/TheAngryRaven/DataViewer_coach", label: "Coach Plugin" },
];

/**
 * The pre-data-load home screen shown by Index.tsx when no telemetry file is
 * loaded. The layout is deliberately simple: a large drag-and-drop dropzone
 * as the primary action, then a grid of big, single-purpose action tiles for
 * everything else (browse, sample, BLE download, track manager, hardware).
 * Reference dialogs (supported files, about, weather, browser compat, contact)
 * and resource links live below.
 *
 * Index.tsx owns the surrounding providers (DeviceProvider, etc.) and the
 * FileManagerDrawer, which the "Browse Saved Files" tile opens via
 * `onOpenFileManager`.
 */
export function LandingPage({
  onDataLoaded,
  onOpenFileManager,
  autoSave,
  autoSaveFile,
  onLoadSample,
  isLoadingSample,
  showSampleFiles,
  enableAdmin,
  enableCloud,
}: LandingPageProps) {
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const { t } = useTranslation(["landing", "common"]);

  const roadmapItems = t("landing:roadmap.items", { returnObjects: true }) as string[];

  // Group roadmap items by their trailing month/quarter parenthetical (works
  // across locales — handles both ASCII "()" and full-width "（）") so we can
  // draw a divider whenever the timeframe changes.
  const roadmapTimeframe = (item: string): string => {
    const match = item.match(/[（(]([^（()）]*)[）)]\s*$/);
    return match ? match[1].trim() : "";
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">LapWing</h1>
              <p className="text-sm text-muted-foreground">{t("landing:tagline")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SupportedFilesDialog />
            <AboutDialog />
            {enableCloud && (
              user ? (
                <Button variant="ghost" size="sm" className="gap-2" onClick={logout} title={user.email ?? undefined}>
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("common:actions.signOut")}</span>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate('/login')}>
                  <LogIn className="w-4 h-4" />
                  <span className="hidden sm:inline">{t("common:actions.signIn")}</span>
                </Button>
              )
            )}
            <a
              href="https://github.com/sponsors/TheAngryRaven"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => interceptExternal(e, "https://github.com/sponsors/TheAngryRaven")}
            >
              <Button variant="outline" size="sm" className="gap-2">
                <Heart className="w-4 h-4 text-pink-500" />
                <span className="hidden sm:inline">{t("common:actions.sponsor")}</span>
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-10">
        <div className="mx-auto w-full max-w-4xl space-y-10">
          {/* Hero */}
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              {t("landing:hero.title")}
            </h2>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">
              {t("landing:hero.subtitle")}
            </p>
          </div>

          {/* Primary action: drag & drop / click to browse */}
          <FileImport onDataLoaded={onDataLoaded} autoSave={autoSave} autoSaveFile={autoSaveFile} />

          {/* Secondary actions — big, single-purpose tiles */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showSampleFiles && (
              <ActionTile
                icon={Play}
                title={t("landing:tiles.sample.title")}
                description={isLoadingSample ? t("common:actions.loading") : t("landing:tiles.sample.description")}
                onClick={onLoadSample}
                disabled={isLoadingSample}
                spinning={isLoadingSample}
                featured
              />
            )}

            <ActionTile
              icon={FolderOpen}
              title={t("landing:tiles.browse.title")}
              description={t("landing:tiles.browse.description")}
              onClick={onOpenFileManager}
            />

            <Suspense
              fallback={
                <ActionTile
                  icon={Bluetooth}
                  title={t("landing:tiles.logger.title")}
                  description={t("common:actions.loading")}
                  disabled
                />
              }
            >
              <DataloggerDownload
                onDataLoaded={onDataLoaded}
                autoSave={autoSave}
                autoSaveFile={autoSaveFile}
                renderTrigger={({ onConnect, bleSupported }) => (
                  <ActionTile
                    icon={Bluetooth}
                    title={t("landing:tiles.logger.title")}
                    description={
                      bleSupported
                        ? t("landing:tiles.logger.description")
                        : t("landing:tiles.logger.unsupportedDescription")
                    }
                    onClick={onConnect}
                    disabled={!bleSupported}
                    hint={bleSupported ? undefined : t("landing:tiles.logger.unsupportedHint")}
                  />
                )}
              />
            </Suspense>

            {/* Track manager — create/draw tracks & courses without a datalog. */}
            <TrackEditor
              triggerButton={
                <ActionTile
                  icon={Map}
                  title={t("landing:tiles.tracks.title")}
                  description={t("landing:tiles.tracks.description")}
                  badge={enableCloud ? t("landing:tiles.tracks.badge") : undefined}
                />
              }
            />

            <ActionTile
              icon={Cpu}
              title={t("landing:tiles.build.title")}
              description={t("landing:tiles.build.description")}
              href="https://github.com/TheAngryRaven/DovesDataLogger"
            />

            {/* Plugin-contributed landing tiles (e.g. the Tools plugin). Renders
                nothing when no plugin targets the slot, so the grid is unchanged
                in a plugin-absent build. */}
            <PluginMount slot={MountSlot.Landing} ctx={{}} />
          </div>

          {/* Roadmap — what's still coming, with rough timing estimates. */}
          <div className="rounded-xl border border-border bg-card/50 p-5">
            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold text-foreground">
                {t("landing:roadmap.title")}
              </h3>
              <span className="text-xs text-muted-foreground">
                ({t("landing:roadmap.estimated")})
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("landing:roadmap.blurb")}
            </p>
            <ul className="mt-3 space-y-2">
              {roadmapItems.map((item, i) => {
                const showDivider =
                  i > 0 && roadmapTimeframe(item) !== roadmapTimeframe(roadmapItems[i - 1]);
                return (
                  <Fragment key={item}>
                    {showDivider && (
                      <li aria-hidden="true" className="my-1 border-t border-border/60" />
                    )}
                    <li className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                      <span>{item}</span>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("landing:roadmap.contact")}
            </p>
          </div>

          {/* Reference dialogs */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <BrowserCompatDialog />
            <span className="inline-flex">
              <LocalWeatherDialog />
            </span>
            <ContactDialog variant="header" />
          </div>

          {/* Open-source repos */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {GITHUB_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => interceptExternal(e, link.href)}
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="w-4 h-4" />
                <span className="text-sm">{link.label}</span>
              </a>
            ))}
          </div>

          <div className="flex items-center justify-center gap-6 flex-wrap">
            <Link to="/privacy" className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <Shield className="w-3 h-3" />
              {t("landing:links.privacy")}
            </Link>
            <Link to="/terms" className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <FileText className="w-3 h-3" />
              {t("landing:links.terms")}
            </Link>
            <CreditsDialog />
            {enableAdmin && isAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <Shield className="w-3 h-3" />
                {t("landing:links.admin")}
              </button>
            )}
          </div>
        </div>
      </main>

      <footer
        className={cn(
          "border-t px-6 py-4",
          isPreviewBuild() ? "border-warning/60 bg-warning/10" : "border-border",
        )}
      >
        <p className="text-center text-xs text-muted-foreground">
          {t("landing:footer.operatedBy")}{" "}
          <a
            href="https://PerchWerks.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => interceptExternal(e, "https://PerchWerks.com")}
            className="font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            PerchWerks LLC
          </a>
        </p>
        <p
          className={cn(
            "mt-1 text-center text-[11px]",
            isPreviewBuild() ? "font-semibold text-warning" : "text-muted-foreground/60",
          )}
          title={buildInfo.buildDate ? `Built ${new Date(buildInfo.buildDate).toLocaleString()}` : undefined}
        >
          {commitUrl() ? (
            <a
              href={commitUrl()!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => interceptExternal(e, commitUrl()!)}
              className={cn(
                "underline-offset-4 transition-colors hover:underline",
                isPreviewBuild() ? "hover:text-warning/80" : "hover:text-muted-foreground",
              )}
            >
              {formatBuildLabel()}
            </a>
          ) : (
            formatBuildLabel()
          )}
        </p>
        {isPreviewBuild() && (
          <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] leading-relaxed text-warning">
            <Trans ns="landing" i18nKey="footer.previewWarning" components={{ strong: <strong /> }} />
          </p>
        )}
      </footer>
    </div>
  );
}
