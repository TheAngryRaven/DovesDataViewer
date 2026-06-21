import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isNativeApp } from "@/lib/platform";
import { cn } from "@/lib/utils";

// Placeholder product art — swap these files for real photos when available.
// Kept in /public so they can be replaced without a code change.
const FLEDGLING_IMAGE = "/loggers/fledgling.svg";
const MYCHRON_IMAGE = "/loggers/mychron.svg";
const ALFANO_IMAGE = "/loggers/alfano.svg";

// Brand display names are proper nouns — intentionally not translated.
const FLEDGLING_NAME = "PerchWerks Fledgling";
const MYCHRON_NAME = "AiM MyChron 5 / 5S / 2T";
const ALFANO_NAME = "Alfano 6 / 7";

interface LoggerPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether Web Bluetooth is available — gates the Fledgling (BLE) tile. */
  bleSupported: boolean;
  /** Begin the standard Bluetooth download flow (PerchWerks Fledgling). */
  onSelectFledgling: () => void;
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
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors",
        "hover:border-primary/50 hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {badge && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          {badge}
        </span>
      )}
      <img src={image} alt={name} loading="lazy" className="aspect-[4/3] w-full object-cover" />
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
export function LoggerPicker({ open, onOpenChange, bleSupported, onSelectFledgling }: LoggerPickerProps) {
  const { t } = useTranslation("logger");
  const [info, setInfo] = useState<"mychron" | "alfano" | null>(null);
  const native = isNativeApp();

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
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
              onClick={() => setInfo("mychron")}
            />
            <LoggerCard
              image={ALFANO_IMAGE}
              name={ALFANO_NAME}
              tag={t("tags.alfano")}
              badge={t("comingSoon")}
              onClick={() => setInfo("alfano")}
            />
          </div>
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
