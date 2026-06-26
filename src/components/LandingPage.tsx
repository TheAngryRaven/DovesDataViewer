import { Fragment, type ReactNode } from "react";
import {
  Shield,
  Play,
  FileText,
  Cpu,
  FolderOpen,
  Map,
  Bluetooth,
  Route,
  Trophy,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { SiteHeader } from "@/components/SiteHeader";
import { FileImport } from "@/components/FileImport";
import { ActionTile } from "@/components/ActionTile";
import { TrackEditor } from "@/components/TrackEditor";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
import { BrowserCompatDialog } from "@/components/BrowserCompatDialog";
import { ContactDialog } from "@/components/ContactDialog";
import { CreditsDialog } from "@/components/CreditsDialog";
import { PluginMount } from "@/plugins/PluginMount";
import { MountSlot } from "@/plugins/mounts";
import { useAuth } from "@/contexts/AuthContext";
import { buildInfo, formatBuildLabel, commitUrl, isPreviewBuild } from "@/lib/buildInfo";
import { interceptExternal, isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { ParsedData } from "@/types/racing";

// Eager: the logger picker is lightweight and must open instantly. The heavy
// BLE flow it launches stays lazy (loaded only when the Fledgling is picked),
// so the protocol bundle is still kept off the initial landing payload.
import { LoggerDownload } from "@/components/LoggerDownload";

interface LandingPageProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  onOpenFileManager: () => void;
  /** Opens the file-manager drawer straight to the Profile (account) tab. */
  onOpenProfile: () => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
  onLoadSample: () => void;
  isLoadingSample: boolean;
  /** When false, the sample log is hidden everywhere — including this tile. */
  showSampleFiles: boolean;
  enableAdmin: boolean;
  enableCloud: boolean;
  /** The settings modal (trigger + dialog), rendered in the header. */
  settingsButton: ReactNode;
}

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
  onOpenProfile,
  autoSave,
  autoSaveFile,
  onLoadSample,
  isLoadingSample,
  showSampleFiles,
  enableAdmin,
  enableCloud,
  settingsButton,
}: LandingPageProps) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { t } = useTranslation(["landing", "common"]);

  // On the native (Tauri/Android) shell the user has already installed the app,
  // so the marketing surfaces (hero pitch, roadmap, GitHub/sponsor links) just
  // add noise — hide them. The DIY-logger tile stays (it's genuinely useful).
  const native = isNativeApp();

  const roadmapItems = t("landing:roadmap.items", { returnObjects: true }) as {
    text: string;
    sub?: string[];
  }[];

  // Group roadmap items by their trailing month/quarter parenthetical (works
  // across locales — handles both ASCII "()" and full-width "（）") so we can
  // draw a divider whenever the timeframe changes.
  const roadmapTimeframe = (text: string): string => {
    const match = text.match(/[（(]([^（()）]*)[）)]\s*$/);
    return match ? match[1].trim() : "";
  };

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-x">
      <SiteHeader settingsButton={settingsButton} enableCloud={enableCloud} onOpenProfile={onOpenProfile} />

      <main className="flex-1 px-6 py-10">
        <div className="mx-auto w-full max-w-4xl space-y-10">
          {/* Hero — pure marketing, so it's dropped on the native shell where
              the user has already chosen to install the app. */}
          {!native && (
            <div className="text-center space-y-3">
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
                {t("landing:hero.title")}
              </h2>
              <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                {t("landing:hero.subtitle")}
              </p>
              <p className="text-sm font-medium text-primary">
                {t("landing:hero.offlineNote")}
              </p>
            </div>
          )}

          {/* Primary action: a 50/50 split — most users download straight off a
              logger, so it gets equal billing with drag & drop / click-to-browse. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
            <LoggerDownload
              onDataLoaded={onDataLoaded}
              autoSave={autoSave}
              autoSaveFile={autoSaveFile}
              renderTrigger={({ onOpen }) => (
                <button
                  type="button"
                  onClick={onOpen}
                  className="flex h-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card/50 p-10 text-center transition-colors hover:border-primary/50 hover:bg-card"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bluetooth className="h-7 w-7" />
                  </span>
                  <span className="text-xl font-semibold text-foreground">
                    {t("landing:tiles.logger.title")}
                  </span>
                  <span className="max-w-md text-sm text-muted-foreground">
                    {t("landing:tiles.logger.description")}
                  </span>
                </button>
              )}
            />
            <FileImport onDataLoaded={onDataLoaded} autoSave={autoSave} autoSaveFile={autoSaveFile} />
          </div>

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

            {/* Public leaderboards — only meaningful with the cloud backend. */}
            {enableCloud && (
              <ActionTile
                icon={Trophy}
                title={t("landing:tiles.leaderboards.title")}
                description={t("landing:tiles.leaderboards.description")}
                onClick={() => navigate('/leaderboards')}
              />
            )}

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

          {/* Roadmap — what's still coming, with rough timing estimates.
              Hidden on native: it's a sales surface for a user who's already in. */}
          {!native && (
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
                  i > 0 && roadmapTimeframe(item.text) !== roadmapTimeframe(roadmapItems[i - 1].text);
                return (
                  <Fragment key={item.text}>
                    {showDivider && (
                      <li aria-hidden="true" className="my-1 border-t border-border/60" />
                    )}
                    <li className="text-sm text-muted-foreground">
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                        <span>{item.text}</span>
                      </div>
                      {item.sub && item.sub.length > 0 && (
                        <ul className="mt-1.5 space-y-1 pl-5">
                          {item.sub.map((sub) => (
                            <li key={sub} className="flex items-start gap-2">
                              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/40" />
                              <span>{sub}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
            <p className="mt-3 text-sm font-medium text-foreground">
              {t("landing:roadmap.contact")}
            </p>
          </div>
          )}

          {/* Reference dialogs — Credits sits to the left of Browser Compatibility. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <CreditsDialog />
            <BrowserCompatDialog />
            <span className="inline-flex">
              <LocalWeatherDialog />
            </span>
            <ContactDialog variant="header" />
          </div>

          {enableAdmin && isAdmin && (
            <div className="flex items-center justify-center gap-6 flex-wrap">
              <button
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <Shield className="w-3 h-3" />
                {t("landing:links.admin")}
              </button>
            </div>
          )}
        </div>
      </main>

      <footer
        className={cn(
          "border-t px-6 py-4",
          isPreviewBuild() ? "border-warning/60 bg-warning/10" : "border-border",
        )}
      >
        {/* Operated-by + build stamp read as one solid block. On the stable
            (non-preview) build, Privacy flanks it on the left and Terms on the
            right; the preview build keeps the block centered + the warning. */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
          {!isPreviewBuild() && (
            <Link
              to="/privacy"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <Shield className="w-3 h-3" />
              {t("landing:links.privacy")}
            </Link>
          )}

          <div>
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
          </div>

          {!isPreviewBuild() && (
            <Link
              to="/terms"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <FileText className="w-3 h-3" />
              {t("landing:links.terms")}
            </Link>
          )}
        </div>
        {isPreviewBuild() && (
          <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] leading-relaxed text-warning">
            <Trans ns="landing" i18nKey="footer.previewWarning" components={{ strong: <strong /> }} />
          </p>
        )}
      </footer>
    </div>
  );
}
