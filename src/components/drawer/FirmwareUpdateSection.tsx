import { useTranslation } from "react-i18next";
import { Cpu, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFirmwareUpdateApi } from "@/contexts/FirmwareUpdateContext";

/**
 * Firmware version display + "Check for updates".
 *
 * The dialog it used to own now lives in `FirmwareUpdateProvider`, rendered
 * once high in the tree — this section only mounts when the drawer is open on
 * the Device tab's settings sub-tab, which is nowhere near often enough for a
 * check that fires on connect.
 */
export function FirmwareUpdateSection() {
  const { t } = useTranslation("drawer");
  const fw = useFirmwareUpdateApi();

  const versionLabel = fw.loadingVersion
    ? t("firmware.readingVersion")
    : fw.versionError
      ? t("firmware.versionUnavailable")
      : fw.info?.version
        ? `${t("firmware.version", { version: fw.info.version })}${fw.info.variant ? ` · ${fw.info.variant}` : ""}`
        : t("firmware.versionUnknown");

  return (
    <div className="space-y-2 pb-3 border-b border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t("firmware.firmware")}</p>
            <p className="text-xs text-muted-foreground truncate">{versionLabel}</p>
          </div>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        disabled={fw.checking || fw.flashing}
        // Explicitly checked, so it narrates the result and ignores any
        // "remind me tomorrow" the user took earlier.
        onClick={() => void fw.checkForUpdates()}
      >
        {fw.checking ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        {t("firmware.checkForUpdates")}
      </Button>
    </div>
  );
}
