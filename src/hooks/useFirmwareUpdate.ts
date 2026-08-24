import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import type { BleConnection } from "@/lib/bleDatalogger";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { snoozeFirmwareUpdate } from "@/lib/firmwareUpdateReminder";
import { isPreviewBuild } from "@/lib/buildInfo";
import { isDebugEnabled } from "@/lib/debugConsole";
import { beginFirmwareUpdate, uploadFirmwareImage, applyFirmware } from "@/lib/ble";
import {
  acquireFirmwareImage,
  evaluateFirmwareUpdate,
  explainFirmwareFailure,
  forceKindFor,
  fetchFirmwareManifest,
  readDeviceFirmwareInfo,
  type DeviceFirmwareInfo,
  type FirmwareBuild,
  type FirmwareForceKind,
} from "@/lib/ble/dfu";

/** Coarse phase shown in the update dialog. */
export type FirmwareFlashPhase =
  | "downloading"
  | "uploading"
  | "verifying"
  | "installing"
  | "done"
  | "error";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Debug log, only when the on-screen console is enabled (?dbg=true). */
function fwLog(...args: unknown[]): void {
  if (isDebugEnabled()) console.info("[firmware]", ...args);
}

/** Fixed id so repeated checks replace the toast instead of stacking it. */
const UP_TO_DATE_TOAST_ID = "firmware-up-to-date";
/** Long enough to read the line and reach for the action on it. */
const UP_TO_DATE_TOAST_MS = 15_000;

/**
 * Orchestrates the SD-staged firmware-update flow for a connected logger:
 * read installed version → check the OTA manifest → (on confirm) download the
 * image, run the CRC handshake, upload it to the device's SD, let the device
 * verify + install it, and auto-disconnect when it reboots.
 *
 * The transfer/manifest/CRC/version logic is the unit-tested code in
 * `@/lib/ble` + `@/lib/ble/dfu`; this hook is the React state glue. Installing is
 * marked on `DeviceContext` so the expected BLE drop (the reboot into the new
 * firmware) doesn't tear down the UI mid-update.
 */
export function useFirmwareUpdate(connection: BleConnection | null) {
  const { setFlashing, disconnectDevice, deviceName } = useDeviceContext();

  const [info, setInfo] = useState<DeviceFirmwareInfo | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [pendingBuild, setPendingBuild] = useState<FirmwareBuild | null>(null);
  /**
   * Why the version check was bypassed, or `null` when it wasn't. The dialog
   * shows different copy for each: a preview build always pushes updates
   * through for testers, whereas a user-initiated force is a deliberate
   * reinstall or downgrade and should say so.
   */
  const [forceKind, setForceKind] = useState<FirmwareForceKind>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [flashing, setFlashingLocal] = useState(false);
  const [phase, setPhase] = useState<FirmwareFlashPhase | null>(null);
  const [percent, setPercent] = useState(0);
  const [flashError, setFlashError] = useState<string | null>(null);
  // If the install reached the point where the device reboots, the link is dead —
  // closing the error dialog must drop the (stale) software connection.
  const [needsDisconnect, setNeedsDisconnect] = useState(false);

  // Read the installed firmware version whenever a connection appears.
  //
  // Everything about the PREVIOUS device's offer is cleared here too. It used
  // to clear only `info`, so a swap left `latestVersion` and `pendingBuild`
  // behind — and `snooze()` keys on `deviceName` + `latestVersion`, so it could
  // write a snooze for a device/version pair that never existed. The force path
  // makes that easier to reach, because it populates the same state without any
  // update actually being available.
  useEffect(() => {
    setLatestVersion(null);
    setPendingBuild(null);
    setForceKind(null);
    setConfirmOpen(false);
    if (!connection) {
      setInfo(null);
      setVersionError(null);
      return;
    }
    let cancelled = false;
    setLoadingVersion(true);
    setVersionError(null);
    readDeviceFirmwareInfo(connection.server)
      .then((i) => !cancelled && setInfo(i))
      .catch((e) => !cancelled && setVersionError(errorMessage(e)))
      .finally(() => !cancelled && setLoadingVersion(false));
    return () => {
      cancelled = true;
    };
  }, [connection]);

  /**
   * Check the OTA manifest and, if there's something newer, open the confirm
   * dialog. Returns whether an update was actually offered, so an automatic
   * caller knows whether it still owns the screen.
   *
   * `silent` suppresses the "you're up to date" / "check failed" toasts. An
   * automatic check on every connect must not narrate itself — the user didn't
   * ask, and being told nothing happened is worse than being told nothing.
   * `suppress` gets the offered version and can decline the dialog, which is
   * how "remind me tomorrow" survives a reconnect without skipping a *newer*
   * release.
   *
   * `force` skips the version comparison entirely, so the manifest's build is
   * always offered — a reinstall of the same version, or a downgrade. It is how
   * a user gets off a build the comparison won't move them from (a beta ahead
   * of the release, or a suspect flash), and it deliberately ignores `suppress`
   * too: someone who just asked for this is not being reminded tomorrow.
   */
  const checkForUpdates = useCallback(
    async (
      options: {
        silent?: boolean;
        suppress?: (version: string) => boolean;
        force?: boolean;
      } = {},
    ) => {
      if (!connection) return false;
      const { silent = false, suppress, force = false } = options;
      setChecking(true);
      try {
        const current = info ?? (await readDeviceFirmwareInfo(connection.server));
        if (current !== info) setInfo(current);
        const manifest = await fetchFirmwareManifest();
        setLatestVersion(manifest.version);
        // On beta/preview builds the version check is bypassed so testers can
        // always re-flash (same as our other non-main behaviors). An explicit
        // `force` does the same thing on any build, at the user's request.
        const evaluation = evaluateFirmwareUpdate(current, manifest, {
          force: force || isPreviewBuild(),
        });
        if (evaluation.available && evaluation.build) {
          if (!force && suppress?.(manifest.version)) return false;
          setPendingBuild(evaluation.build);
          setForceKind(forceKindFor(evaluation.reason, force, current.version));
          setConfirmOpen(true);
          return true;
        }
        if (!silent) {
          switch (evaluation.reason) {
            case "up-to-date": {
              // Offer the way out right here. The manifest and the matched
              // build are already in hand, so this opens the confirm dialog
              // directly rather than re-running the whole check.
              //
              // A fixed id de-dupes repeated checks, and the longer duration is
              // the point: this toast carries the ONLY escape hatch a user who
              // just hit the wall is looking at, and sonner's ~4 s default is
              // not long enough to read a sentence and then decide.
              const build = evaluation.build;
              toast.success(
                i18n.t("drawer:firmware.upToDateToast", { version: current.version ?? "?" }),
                {
                  id: UP_TO_DATE_TOAST_ID,
                  duration: UP_TO_DATE_TOAST_MS,
                  action: build
                    ? {
                        label: i18n.t("drawer:firmware.installAnyway"),
                        onClick: () => {
                          setPendingBuild(build);
                          setForceKind("user");
                          setConfirmOpen(true);
                        },
                      }
                    : undefined,
                },
              );
              break;
            }
            case "no-version":
              toast.error(i18n.t("drawer:firmware.checkNoVersion"));
              break;
            case "no-build":
              toast.error(i18n.t("drawer:firmware.checkNoBuild"));
              break;
          }
        }
        return false;
      } catch (e) {
        if (!silent) {
          toast.error(i18n.t("drawer:firmware.checkFailed", { error: errorMessage(e) }));
        }
        return false;
      } finally {
        setChecking(false);
      }
    },
    [connection, info],
  );

  const cancel = useCallback(() => {
    setConfirmOpen(false);
    setPendingBuild(null);
    setForceKind(null);
  }, []);

  /** Decline for 24 hours. Same as cancel, plus a note so we don't re-ask. */
  const snooze = useCallback(() => {
    snoozeFirmwareUpdate(deviceName, latestVersion);
    cancel();
  }, [cancel, deviceName, latestVersion]);

  const startUpdate = useCallback(async () => {
    if (!connection || !pendingBuild) {
      // Reachable now that the confirm can be opened from a toast action the
      // user may sit on: the link can drop in between. Saying nothing would
      // read as a dead button.
      setConfirmOpen(false);
      toast.error(i18n.t("drawer:firmware.startNoConnection"));
      return;
    }
    const build = pendingBuild;
    setConfirmOpen(false);
    setFlashError(null);
    setPercent(0);
    setFlashingLocal(true);
    setFlashing(true);
    let installing = false;
    // Kept for the failure path: a device that rejects on SIZE needs to be told
    // how big the image was and which version unlocks it.
    let imageBytes: number | null = null;

    try {
      // 0. Download the image (prefer the raw .bin), compute its CRC, and verify
      //    against the manifest's published size/CRC — the first link of the
      //    full-circle CRC chain (catches a corrupt download before the device
      //    is involved). Falls back to unzipping the dfuZip for older manifests.
      setPhase("downloading");
      fwLog("downloading", build.name, build.appBin ?? build.dfuZip);
      const { image, crc } = await acquireFirmwareImage(build);
      imageBytes = image.length;
      fwLog("image ready + verified vs manifest", { bytes: image.byteLength, crc });

      // 1–3. CRC handshake — verify the control channel, and declare the target
      //       variant so the device rejects a wrong-variant image up front.
      await beginFirmwareUpdate(connection, image.length, crc, build.variant);
      fwLog("crc handshake ok", { variant: build.variant });

      // 4–6. Upload to SD, then the device re-verifies the stored file's CRC.
      setPhase("uploading");
      await uploadFirmwareImage(connection, image, crc, (p) => {
        setPercent(p.total > 0 ? Math.round((p.sent / p.total) * 100) : 0);
        if (p.sent >= p.total) setPhase("verifying");
      });
      fwLog("upload + on-device CRC verified");

      // 7–8. Install (stage → flash → reset).
      installing = true;
      setPhase("installing");
      setPercent(0);
      await applyFirmware(connection, (pct) => setPercent(pct));
      fwLog("FWAPPLIED — device rebooting");

      setPhase("done");
      setPercent(100);
      toast.success("Firmware flashed — your device is rebooting");
      // Keep DeviceContext's flashing flag TRUE so the reboot's BLE drop doesn't
      // tear down the "complete" dialog. The user acknowledges via finish().
    } catch (e) {
      fwLog("update failed", { installing, error: errorMessage(e) });
      // A raw "SIZE" tells the user nothing — the cap lives in the firmware
      // already on the device, and the remedy is a hop through an older
      // release. Say that instead.
      const explained = explainFirmwareFailure(e, {
        installedVersion: info?.version,
        imageBytes,
      });
      const message = explained?.message ?? errorMessage(e);
      setPhase("error");
      setFlashError(message);
      setNeedsDisconnect(installing);
      setFlashing(false);
      toast.error(explained ? message : `Firmware update failed: ${message}`);
    } finally {
      setFlashingLocal(false);
    }
  }, [connection, pendingBuild, setFlashing, info]);

  /** Dismiss the error state; drops the connection if the device had rebooted. */
  const dismiss = useCallback(() => {
    setPhase(null);
    setFlashError(null);
    setPercent(0);
    // The offer is spent either way — leaving `forceKind` set would carry the
    // amber bypass note into whatever the next dialog turns out to be.
    setForceKind(null);
    if (needsDisconnect) {
      setNeedsDisconnect(false);
      disconnectDevice();
    }
  }, [needsDisconnect, disconnectDevice]);

  /**
   * Acknowledge a completed flash: clears the flashing flag (re-enabling normal
   * disconnect handling) and drops the now-rebooted device so the UI returns to
   * the connect screen. The user reconnects to the freshly-flashed firmware.
   */
  const finish = useCallback(() => {
    setPhase(null);
    setPercent(0);
    setForceKind(null);
    setFlashing(false);
    disconnectDevice();
  }, [setFlashing, disconnectDevice]);

  return {
    info,
    loadingVersion,
    versionError,
    checking,
    latestVersion,
    pendingBuild,
    /** True when the version check was bypassed, whatever the reason. */
    forced: forceKind !== null,
    forceKind,
    confirmOpen,
    flashing,
    phase,
    percent,
    flashError,
    checkForUpdates,
    cancel,
    snooze,
    startUpdate,
    dismiss,
    finish,
  };
}
