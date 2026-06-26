import { type ReactNode } from "react";
import { Heart, LogIn, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { SupportedFilesDialog } from "@/components/SupportedFilesDialog";
import { AboutDialog } from "@/components/AboutDialog";
import { useAuth } from "@/contexts/AuthContext";
import { interceptExternal, isNativeApp } from "@/lib/platform";

interface SiteHeaderProps {
  /** The settings modal (trigger + dialog), rendered just left of the account button. */
  settingsButton: ReactNode;
  enableCloud: boolean;
  /** Opens the Profile (account) surface. */
  onOpenProfile: () => void;
  /** Show the "Supported files" reference dialog button (default true). */
  showSupportedFiles?: boolean;
  /** Show the "About" dialog button (default true). */
  showAbout?: boolean;
  /** Extra controls rendered between the brand and the right-hand button cluster. */
  children?: ReactNode;
}

/**
 * The shared sticky top banner: brand + sponsor on the left, and a reference /
 * settings / account cluster on the right. Used by the landing page (everything
 * shown) and the Leaderboards page (supported-files + about hidden), so the two
 * banners stay identical by construction.
 */
export function SiteHeader({
  settingsButton,
  enableCloud,
  onOpenProfile,
  showSupportedFiles = true,
  showAbout = true,
  children,
}: SiteHeaderProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation(["common"]);
  const native = isNativeApp();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur safe-area-top">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <BrandLogo className="w-8 h-8" />
          <h1 className="text-xl font-semibold text-foreground">LapWing</h1>
          {!native && (
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
          )}
        </div>
        <div className="flex items-center gap-2">
          {children}
          {showSupportedFiles && <SupportedFilesDialog />}
          {showAbout && <AboutDialog />}
          {settingsButton}
          {enableCloud && (
            user ? (
              <Button size="sm" className="gap-2" onClick={onOpenProfile} title={user.email ?? undefined}>
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">{t("common:actions.profile")}</span>
              </Button>
            ) : (
              <Button size="sm" className="gap-2" onClick={() => navigate('/login')}>
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">{t("common:actions.signIn")}</span>
              </Button>
            )
          )}
        </div>
      </div>
    </header>
  );
}
