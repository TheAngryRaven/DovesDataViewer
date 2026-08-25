/**
 * Body of the native (Tauri) Fledgling firmware-update screen, rendered by
 * `DovesloggerDownload` in its `firmware` state. All flow logic lives in
 * `useNativeFirmwareUpdate`; this renders one panel per phase and reuses the
 * web update dialog's copy (`drawer:firmware.*`) where it's identical.
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorPanel } from "@/components/loggers/DownloadPanels";
import { loggerErrorKey, recoveryActionFor } from "@/lib/loggers/errors";
import type { useNativeFirmwareUpdate } from "@/hooks/useNativeFirmwareUpdate";

interface NativeFirmwarePanelProps {
  update: ReturnType<typeof useNativeFirmwareUpdate>;
  /** The device rebooted (update sent) — host disconnects and rescans. */
  onDone: () => void;
  /** Leave the firmware screen back to the device's file list. */
  onBack: () => void;
}

export function NativeFirmwarePanel({ update, onDone, onBack }: NativeFirmwarePanelProps) {
  const { t } = useTranslation(["logger", "drawer"]);
  const {
    phase,
    latestVersion,
    variants,
    pendingBuild,
    forceKind,
    percent,
    failure,
    begin,
    chooseVariant,
    install,
  } = update;

  // Why the version check was skipped decides what the note says: the beta-branch
  // note is only true on a preview build, and it explained the wrong thing when
  // the real reason was an unreadable version.
  const forcedNote =
    forceKind === "preview"
      ? t("drawer:firmware.betaNote")
      : forceKind === "user"
        ? t("drawer:firmware.forcedUserNote")
        : forceKind === "unknown"
          ? t("drawer:firmware.forcedUnknownNote")
          : null;

  // Start the manifest check as soon as the screen opens (once per mount).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void begin();
    }
  }, [begin]);

  if (phase === "idle" || phase === "checking") {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-muted-foreground">{t("logger:doveslogger.firmware.checking")}</p>
      </div>
    );
  }

  if (phase === "up-to-date") {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-sm text-center text-muted-foreground">
          {t("logger:doveslogger.firmware.upToDate", { version: update.installedVersion ?? "?" })}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            {t("logger:doveslogger.firmware.back")}
          </Button>
          {/* The way off a build the comparison won't move — a beta ahead of
              the published release, or a reinstall of the same version. */}
          <Button variant="ghost" onClick={() => void begin({ force: true })}>
            {t("drawer:firmware.installAnyway")}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "no-build") {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-sm text-center text-muted-foreground">
          {t("logger:doveslogger.firmware.noBuild")}
        </p>
        <Button variant="outline" onClick={onBack}>
          {t("logger:doveslogger.firmware.back")}
        </Button>
      </div>
    );
  }

  if (phase === "variant-confirm") {
    return (
      <div className="flex flex-col gap-4 py-4">
        <p className="font-medium text-sm">{t("logger:doveslogger.firmware.variantConfirmTitle")}</p>
        <p className="text-sm text-muted-foreground">
          {t("logger:doveslogger.firmware.variantConfirmBody")}
        </p>
        <div className="flex flex-col gap-2">
          {variants.map((variant) => (
            <Button key={variant} variant="secondary" onClick={() => chooseVariant(variant)}>
              {variant}
            </Button>
          ))}
        </div>
        <Button variant="outline" onClick={onBack}>
          {t("logger:doveslogger.firmware.back")}
        </Button>
      </div>
    );
  }

  if (phase === "confirm" && pendingBuild) {
    return (
      <div className="flex flex-col gap-4 py-4">
        <p className="font-medium text-sm">
          {t("logger:doveslogger.firmware.installLatest", {
            version: latestVersion ?? "?",
            variant: pendingBuild.variant,
          })}
        </p>
        {forcedNote && <p className="text-xs text-muted-foreground">{forcedNote}</p>}
        <div className="text-sm text-muted-foreground">
          <p>{t("drawer:firmware.beforeStart")}</p>
          <ul className="list-disc pl-5 mt-1 space-y-1">
            <li>{t("drawer:firmware.li1")}</li>
            <li>{t("drawer:firmware.li2")}</li>
            <li>{t("drawer:firmware.li3")}</li>
          </ul>
          <p className="mt-2">{t("drawer:firmware.interrupting")}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onBack}>
            {t("drawer:firmware.cancel")}
          </Button>
          <Button onClick={() => void install()}>{t("logger:doveslogger.firmware.install")}</Button>
        </div>
      </div>
    );
  }

  if (phase === "downloading" || phase === "uploading") {
    const uploading = phase === "uploading";
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="text-muted-foreground">
          {uploading ? t("drawer:firmware.phaseUploading") : t("drawer:firmware.phaseDownloading")}
        </p>
        {uploading && (
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        <p className="text-xs text-center text-muted-foreground">
          {uploading
            ? t("drawer:firmware.progressPercent", { percent })
            : t("drawer:firmware.progressIndeterminate")}
        </p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-sm text-center">{t("logger:doveslogger.firmware.rebooting")}</p>
        <p className="text-sm text-center text-muted-foreground">
          {t("logger:doveslogger.firmware.rebootingBody")}
        </p>
        <Button onClick={onDone}>{t("drawer:firmware.done")}</Button>
      </div>
    );
  }

  if (phase === "unavailable") {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <p className="text-sm text-center text-muted-foreground">
          {t("logger:doveslogger.firmware.notAvailable")}
        </p>
        <p className="text-sm text-center text-muted-foreground">
          {t("logger:doveslogger.firmware.notAvailableBody")}
        </p>
        <Button variant="outline" onClick={onBack}>
          {t("logger:doveslogger.firmware.back")}
        </Button>
      </div>
    );
  }

  // phase === "error"
  if (!failure) return null;
  const action = recoveryActionFor(failure.category, "firmware");
  return (
    <ErrorPanel
      message={t(`logger:${loggerErrorKey(failure.category)}`)}
      detail={failure.detail || undefined}
      detailLabel={t("logger:errors.detailLabel")}
      onCancel={onBack}
      cancelLabel={t("logger:doveslogger.firmware.back")}
      // A pre-flight failure (no build confirmed yet) re-runs the check;
      // a failed download/upload re-runs the install.
      onAction={action !== "none" ? () => void (pendingBuild ? install() : begin()) : undefined}
      actionLabel={action !== "none" ? t("logger:errors.actionRetry") : undefined}
    />
  );
}
