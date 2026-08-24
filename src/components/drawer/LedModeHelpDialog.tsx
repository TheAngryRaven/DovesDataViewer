import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * What each status-LED mode does, and what its colours mean.
 *
 * A Dialog rather than a Tooltip on purpose: this is eight modes with up to
 * five colour states each, and Radix tooltips do not open reliably on touch —
 * which is most of the audience for a device sitting on a kart.
 *
 * `swatches` are literal LED colours, not theme colours: the point is to match
 * what the strip actually shows, so they must not follow light/dark mode.
 */
const MODE_KEYS = [
  "off",
  "rpm",
  "speed",
  "gps",
  "camera",
  "lap",
  "sector",
  "egt",
] as const;

/** Colour chips per mode, in the order the states are described. */
const MODE_SWATCHES: Record<(typeof MODE_KEYS)[number], string[]> = {
  off: [],
  rpm: ["#ff0000"],
  speed: ["#ff0000"],
  gps: ["#ff0000", "#ff9600", "#0000ff", "#00c000"],
  camera: ["#ff9600", "#0000ff", "#ff0000"],
  lap: ["#00c000", "#ff0000", "#a000ff"],
  sector: ["#00c000", "#ff0000", "#a000ff"],
  egt: ["#ff0000", "#0000ff"],
};

export function LedModeHelpDialog() {
  const { t } = useTranslation("drawer");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={t("device.ledHelp.open")}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("device.ledHelp.title")}</DialogTitle>
          <DialogDescription>{t("device.ledHelp.intro")}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3">
          {MODE_KEYS.map((key) => (
            <div key={key}>
              <dt className="flex items-center gap-2 text-sm font-medium text-foreground">
                {MODE_SWATCHES[key].length > 0 && (
                  <span className="flex shrink-0 gap-1" aria-hidden="true">
                    {MODE_SWATCHES[key].map((c, i) => (
                      <span
                        key={i}
                        className="h-2.5 w-2.5 rounded-full ring-1 ring-black/20"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                )}
                {t(`device.ledHelp.modes.${key}.name`)}
              </dt>
              <dd className="text-xs text-muted-foreground">
                {t(`device.ledHelp.modes.${key}.body`)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{t("device.ledHelp.footer")}</p>
      </DialogContent>
    </Dialog>
  );
}
