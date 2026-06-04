import { Gauge, Github, Heart, Shield, BookOpen, Play, Loader2, LogIn, LogOut, FileText, Cpu } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileImport } from "@/components/FileImport";
import { LocalWeatherDialog } from "@/components/LocalWeatherDialog";
import { BrowserCompatDialog } from "@/components/BrowserCompatDialog";
import { ContactDialog } from "@/components/ContactDialog";
import { SupportedFilesDialog } from "@/components/SupportedFilesDialog";
import { AboutDialog } from "@/components/AboutDialog";
import { CreditsDialog } from "@/components/CreditsDialog";
import { PricingCards } from "@/components/PricingCards";
import { useAuth } from "@/contexts/AuthContext";
import { buildInfo, formatBuildLabel, commitUrl, isPreviewBuild } from "@/lib/buildInfo";
import { cn } from "@/lib/utils";
import type { ParsedData } from "@/types/racing";

interface LandingPageProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  onOpenFileManager: () => void;
  autoSave: boolean;
  autoSaveFile: (name: string, blob: Blob) => Promise<void>;
  onLoadSample: () => void;
  isLoadingSample: boolean;
  enableAdmin: boolean;
  enableCloud: boolean;
}

const GITHUB_LINKS: Array<{ href: string; label: string }> = [
  { href: "https://github.com/TheAngryRaven/DovesDataViewer", label: "View on GitHub" },
  { href: "https://github.com/TheAngryRaven/DovesDataLogger", label: "View Datalogger" },
  { href: "https://github.com/TheAngryRaven/DovesLapTimer", label: "View Timer Library" },
  { href: "https://github.com/TheAngryRaven/DataViewer_coach", label: "Coach Plugin" },
];

/**
 * The pre-data-load view shown by Index.tsx when no telemetry file is loaded.
 * Self-contained content (header, file import, sample loader, footer) plus
 * the three content-only dialogs (Supported Files, About, Credits).
 *
 * Index.tsx owns the surrounding providers (DeviceProvider, etc.) and the
 * FileManagerDrawer, which can also be opened from this landing page via
 * `onOpenFileManager`.
 */
export function LandingPage({
  onDataLoaded,
  onOpenFileManager,
  autoSave,
  autoSaveFile,
  onLoadSample,
  isLoadingSample,
  enableAdmin,
  enableCloud,
}: LandingPageProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gauge className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">HackTheTrack.net</h1>
              <p className="text-sm text-muted-foreground">Experimental Data Viewer</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SupportedFilesDialog />
            <AboutDialog />
            <ContactDialog variant="header" />
            {enableCloud && (
              user ? (
                <Button variant="ghost" size="sm" className="gap-2" onClick={logout} title={user.email ?? undefined}>
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate('/login')}>
                  <LogIn className="w-4 h-4" />
                  <span className="hidden sm:inline">Sign in</span>
                </Button>
              )
            )}
            <a
              href="https://github.com/sponsors/TheAngryRaven"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-2">
                <Heart className="w-4 h-4 text-pink-500" />
                <span className="hidden sm:inline">Sponsor</span>
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 p-8 space-y-12">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <div className="flex justify-end items-center gap-2">
            <LocalWeatherDialog />
          </div>

          <div className="text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Free Online VBO, MoTeC, AiM &amp; NMEA Telemetry Viewer
            </h1>
          </div>

          <a
            href="https://github.com/TheAngryRaven/DovesDataLogger"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-6 py-6 text-center transition-colors hover:border-primary hover:bg-primary/10 sm:flex-row sm:text-left"
          >
            <Cpu className="h-8 w-8 shrink-0 text-primary" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">Build your own datalogger</h3>
              <p className="text-sm text-muted-foreground">
                The DovesDataLogger is fully open source — grab the hardware design and firmware to build your own GPS telemetry logger.
              </p>
            </div>
            <Button variant="default" size="sm" className="mt-2 shrink-0 gap-2 sm:ml-auto sm:mt-0">
              <Github className="h-4 w-4" />
              Get Started
            </Button>
          </a>

          <FileImport
            onDataLoaded={onDataLoaded}
            onOpenFileManager={onOpenFileManager}
            autoSave={autoSave}
            autoSaveFile={autoSaveFile}
          />

          <div className="text-center text-sm text-muted-foreground space-y-3">
            <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h3 className="font-medium text-foreground mb-2">Try it out!</h3>
              <p className="text-xs mb-3">Load sample data from Orlando Kart Center to see how the viewer works.</p>
              <Button variant="default" size="sm" onClick={onLoadSample} disabled={isLoadingSample}>
                {isLoadingSample ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {isLoadingSample ? "Loading..." : "Load Sample Data"}
              </Button>
            </div>
          </div>
        </div>

        <PricingCards className="mx-auto w-full max-w-5xl" />

        <div className="mx-auto w-full max-w-xl space-y-4">
          <div className="flex justify-center">
            <BrowserCompatDialog />
          </div>

          <div className="flex items-center justify-center gap-8">
            {GITHUB_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="w-5 h-5" />
                <span className="text-sm">{link.label}</span>
              </a>
            ))}
          </div>

          <div className="flex items-center justify-center gap-6 flex-wrap">
            <Link to="/privacy" className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <Shield className="w-3 h-3" />
              Privacy Policy
            </Link>
            <Link to="/terms" className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <FileText className="w-3 h-3" />
              Terms of Service
            </Link>
            <ContactDialog />
            <CreditsDialog />
            {enableAdmin && (
              <button
                onClick={() => navigate('/admin')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <Shield className="w-3 h-3" />
                Track Management
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
          Operated by{" "}
          <a
            href="https://PerchWerks.com"
            target="_blank"
            rel="noopener noreferrer"
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
            This branch is running on a preview database — accounts can be wiped at any time. Do not
            rely on data being saved anywhere other than locally. If payments are activated,{" "}
            <strong>do not enter real payment information.</strong>
          </p>
        )}
      </footer>
    </div>
  );
}
