import { useCallback, useRef, useState } from "react";
import { isPreviewBuild } from "@/lib/buildInfo";
import {
  acquireFirmwareImage,
  evaluateFirmwareUpdate,
  fetchFirmwareManifest,
  forceKindFor,
  pickBuildForVariant,
  type FirmwareBuild,
  type FirmwareForceKind,
  type FirmwareManifest,
} from "@/lib/ble/dfu";
import {
  firmwareInfoFromDeviceInfo,
  firmwareUpdateCapability,
} from "@/lib/loggers/doveslogger/firmwareInfo";
import { loggerUpdateFirmware, type LoggerDeviceInfo } from "@/lib/loggers/doveslogger/ipc";
import {
  classifyLoggerError,
  isMissingCommandError,
  type ClassifiedLoggerError,
} from "@/lib/loggers/errors";

/** Where the native firmware-update flow currently is. */
export type NativeFirmwarePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "no-build"
  | "variant-confirm"
  | "confirm"
  | "downloading"
  | "uploading"
  | "done"
  | "unavailable"
  | "error";

// Once the backend says it can't flash (unsupported: / unknown command), stop
// offering the button for the rest of the session — the shell won't change
// under us. Module-level so remounts of the flow remember it.
let firmwareUpdateUnavailable = false;

/** Whether this session already learned the native shell can't flash firmware. */
export function isFirmwareUpdateUnavailable(): boolean {
  return firmwareUpdateUnavailable;
}

/**
 * Orchestrates the native (Tauri) Fledgling firmware update: derive the
 * installed version/variant from the connect handshake's `LoggerDeviceInfo`,
 * check the OTA manifest, download + CRC-verify the image (the shared
 * `lib/ble/dfu` layer the web flow uses), then upload it over
 * `logger_update_firmware`. After the upload the device flashes and reboots —
 * the BLE drop at that point is presented as success, and the host flow lands
 * the user back at the scan screen.
 *
 * Availability is discovered at runtime: an `unsupported:` / unknown-command
 * rejection flips the flow to `unavailable` (and latches for the session)
 * instead of erroring, so the UI degrades gracefully until the LapWing
 * backend command ships.
 */
export function useNativeFirmwareUpdate(deviceInfo: LoggerDeviceInfo | null) {
  const [phase, setPhase] = useState<NativeFirmwarePhase>("idle");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[]>([]);
  const [pendingBuild, setPendingBuild] = useState<FirmwareBuild | null>(null);
  /**
   * Why the version check was bypassed, or `null` when it wasn't. Three things
   * can bypass it here and they are not the same message: a preview build of
   * the app, an unreadable installed version, and the user asking outright.
   */
  const [forceKind, setForceKind] = useState<FirmwareForceKind>(null);
  const [percent, setPercent] = useState(0);
  const [failure, setFailure] = useState<ClassifiedLoggerError | null>(null);
  const manifestRef = useRef<FirmwareManifest | null>(null);
  const uploadCompleteRef = useRef(false);

  const markUnavailable = useCallback(() => {
    firmwareUpdateUnavailable = true;
    setPhase("unavailable");
  }, []);

  /**
   * Kick off the manifest check. Call when the firmware screen opens.
   *
   * `force` skips the version comparison, so the published build is offered
   * whatever the device reports — the way off a build the comparison won't move
   * (a beta ahead of the release, or a reinstall of the same version).
   */
  const begin = useCallback(async (options: { force?: boolean } = {}) => {
    const { force = false } = options;
    if (!deviceInfo) return;
    setFailure(null);
    setPendingBuild(null);
    setForceKind(null);
    setPercent(0);
    setPhase("checking");

    if (firmwareUpdateCapability(deviceInfo) === false) {
      markUnavailable();
      return;
    }

    try {
      const fwInfo = firmwareInfoFromDeviceInfo(deviceInfo);
      setInstalledVersion(fwInfo.version);
      const manifest = manifestRef.current ?? (await fetchFirmwareManifest());
      manifestRef.current = manifest;
      setLatestVersion(manifest.version);
      setVariants([...new Set(Object.values(manifest.builds).map((b) => b.variant))]);

      if (!fwInfo.variant) {
        // The backend didn't report the hardware variant — ask the user.
        setPhase("variant-confirm");
        return;
      }

      // Preview builds bypass the version compare (same as the web flow) so
      // testers can always re-flash; an explicit `force` does it on any build.
      const evaluation = evaluateFirmwareUpdate(fwInfo, manifest, {
        force: force || isPreviewBuild(),
      });
      if (!evaluation.build) {
        setPhase("no-build");
      } else if (evaluation.available) {
        setPendingBuild(evaluation.build);
        setForceKind(forceKindFor(evaluation.reason, force, fwInfo.version));
        setPhase("confirm");
      } else if (evaluation.reason === "no-version") {
        // Version unreadable but the variant matched — offer the latest build
        // behind an explicit confirm.
        setPendingBuild(evaluation.build);
        setForceKind("unknown");
        setPhase("confirm");
      } else {
        setPhase("up-to-date");
      }
    } catch (err) {
      console.error("Native firmware check failed:", err);
      setFailure(classifyLoggerError(err));
      setPhase("error");
    }
  }, [deviceInfo, markUnavailable]);

  /** Resolve the explicit variant pick into a build (variant-confirm state). */
  const chooseVariant = useCallback((variant: string) => {
    const manifest = manifestRef.current;
    if (!manifest) return;
    const build = pickBuildForVariant(manifest, variant);
    if (!build) {
      setPhase("no-build");
      return;
    }
    setPendingBuild(build);
    setForceKind("unknown"); // no installed version to compare against
    setPhase("confirm");
  }, []);

  /** Download the confirmed build and upload it to the device. */
  const install = useCallback(async () => {
    const build = pendingBuild;
    if (!build) return;
    setFailure(null);
    setPercent(0);
    uploadCompleteRef.current = false;

    try {
      setPhase("downloading");
      const { image } = await acquireFirmwareImage(build);

      setPhase("uploading");
      await loggerUpdateFirmware(image, (p) => {
        if (p.total > 0) setPercent(Math.round((p.received / p.total) * 100));
        if (p.received >= p.total) uploadCompleteRef.current = true;
      });
      setPhase("done");
    } catch (err) {
      const classified = classifyLoggerError(err);
      if (classified.category === "unsupported" || isMissingCommandError(err)) {
        markUnavailable();
        return;
      }
      // If the whole image was received before the link dropped, the reboot
      // into the new firmware won the race against the invoke's resolution —
      // that's the documented success shape, not a failure.
      if (
        uploadCompleteRef.current &&
        (classified.category === "unreachable" || classified.category === "hung")
      ) {
        setPhase("done");
        return;
      }
      console.error("Native firmware update failed:", err);
      setFailure(classified);
      setPhase("error");
    }
  }, [pendingBuild, markUnavailable]);

  /** Back out of a pre-flight state (confirm / result screens). */
  const reset = useCallback(() => {
    setPhase("idle");
    setPendingBuild(null);
    setForceKind(null);
    setPercent(0);
    setFailure(null);
  }, []);

  return {
    phase,
    installedVersion,
    latestVersion,
    variants,
    pendingBuild,
    /** True when the version check was bypassed, whatever the reason. */
    forced: forceKind !== null,
    forceKind,
    percent,
    failure,
    begin,
    chooseVariant,
    install,
    reset,
  };
}
