import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";

// Product art lives in /public so it can be swapped without a code change.
const FLEDGLING_IMAGE = "/loggers/fledgling.png";
const MYCHRON_IMAGE = "/loggers/mychron.png";
const ALFANO_IMAGE = "/loggers/alfano.png";

// Brand display names are proper nouns — intentionally not translated.
const FLEDGLING_NAME = "PerchWerks Fledgling";
const MYCHRON_NAME = "AiM MyChron 5+";
const ALFANO_NAME = "Alfano 6+";

interface LoggerPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether Web Bluetooth is available — gates the Fledgling (BLE) tile. */
  bleSupported: boolean;
  /** Begin the standard Bluetooth download flow (PerchWerks Fledgling). */
  onSelectFledgling: () => void;
  /**
   * Begin the native MyChron Wi-Fi flow. Only supplied (and only fired) on the
   * native shell; on web the MyChron card keeps its explanatory dialog.
   */
  onSelectMychron?: () => void;
}

interface LoggerCardProps {
  image: string;
  name: string;
  tag: string;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
  hint?: string;
}

function LoggerCard({ image, name, tag, onClick, disabled, badge, hint }: LoggerCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        // Compact horizontal row on phones (keeps the picker short), full image
        // card from sm+ where there's room.
        "group relative flex flex-row items-center overflow-hidden rounded-xl border bg-card text-left transition-colors",
        "sm:flex-col sm:items-stretch",
        "hover:border-primary/50 hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {badge && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          {badge}
        </span>
      )}
      <img
        src={image}
        alt={name}
        loading="lazy"
        className="h-16 w-24 shrink-0 object-cover sm:h-auto sm:w-full sm:aspect-[4/3]"
      />
      <span className="space-y-0.5 p-3">
        <span className="block font-semibold text-foreground">{name}</span>
        <span className="block text-xs text-muted-foreground">{tag}</span>
      </span>
    </button>
  );
}

/**
 * Image-based logger chooser shown before any download begins. PerchWerks
 * Fledgling runs the normal Web Bluetooth flow; MyChron and Alfano are not yet
 * downloadable and open an explanatory dialog instead (MyChron's copy differs
 * between the native shell and the web app — see `isNativeApp`).
 */
export function LoggerPicker({ open, onOpenChange, bleSupported, onSelectFledgling, onSelectMychron }: LoggerPickerProps) {
  const { t } = useTranslation("logger");
  const [info, setInfo] = useState<"mychron" | "alfano" | null>(null);
  const native = isNativeApp();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Cap the height + scroll so a tall list never pushes the close (X) off
            the top of the screen on mobile; a side gutter keeps the panel off the
            screen edges on mobile, and safe-area-modal padding restores the inner
            padding (which a bare env() inset would zero out) while clearing notches. */}
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto safe-area-modal">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("subtitle")}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LoggerCard
              image={FLEDGLING_IMAGE}
              name={FLEDGLING_NAME}
              tag={t("tags.fledgling")}
              onClick={onSelectFledgling}
              disabled={!bleSupported}
              hint={bleSupported ? undefined : t("fledglingUnsupported")}
            />
            <LoggerCard
              image={MYCHRON_IMAGE}
              name={MYCHRON_NAME}
              tag={t("tags.mychron")}
              // The download only works in the (not-yet-public) native app, so
              // flag it "coming soon" to web users; on native it actually works.
              badge={native ? undefined : t("comingSoon")}
              onClick={() => (native && onSelectMychron ? onSelectMychron() : setInfo("mychron"))}
            />
            <LoggerCard
              image={ALFANO_IMAGE}
              name={ALFANO_NAME}
              tag={t("tags.alfano")}
              badge={t("comingSoon")}
              onClick={() => setInfo("alfano")}
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            {t("trademarks")}
          </p>

          {/* Phones: an explicit way back out (desktop keeps the corner X). */}
          <DialogClose asChild>
            <Button variant="outline" className="w-full sm:hidden">
              {t("close")}
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>

      {/* MyChron — native shows the spec'd placeholder; web explains the upcoming app. */}
      <Dialog open={info === "mychron"} onOpenChange={(o) => !o && setInfo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{native ? t("mychron.nativeTitle") : t("mychron.webTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {native ? t("mychron.nativeBody") : t("mychron.webBody")}
          </p>
        </DialogContent>
      </Dialog>

      {/* Alfano — Bluetooth, no native app needed; coming soon. */}
      <Dialog open={info === "alfano"} onOpenChange={(o) => !o && setInfo(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("alfano.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("alfano.body")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
