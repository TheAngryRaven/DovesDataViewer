import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BleConnection } from "@/lib/bleDatalogger";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { isPreviewBuild } from "@/lib/buildInfo";
import { isDebugEnabled } from "@/lib/debugConsole";
import { crc32Hex, beginFirmwareUpdate, uploadFirmwareImage, applyFirmware } from "@/lib/ble";
import {
  assertImageMatchesBuild,
  evaluateFirmwareUpdate,
  fetchFirmwareManifest,
  fetchFirmwarePackage,
  parseDfuPackage,
  readDeviceFirmwareInfo,
  type DeviceFirmwareInfo,
  type FirmwareBuild,
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
  const { setFlashing, disconnectDevice } = useDeviceContext();

  const [info, setInfo] = useState<DeviceFirmwareInfo | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [pendingBuild, setPendingBuild] = useState<FirmwareBuild | null>(null);
  const [forced, setForced] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [flashing, setFlashingLocal] = useState(false);
  const [phase, setPhase] = useState<FirmwareFlashPhase | null>(null);
  const [percent, setPercent] = useState(0);
  const [flashError, setFlashError] = useState<string | null>(null);
  // If the install reached the point where the device reboots, the link is dead —
  // closing the error dialog must drop the (stale) software connection.
  const [needsDisconnect, setNeedsDisconnect] = useState(false);

  // Read the installed firmware version whenever a connection appears.
  useEffect(() => {
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

  const checkForUpdates = useCallback(async () => {
    if (!connection) return;
    setChecking(true);
    try {
      const current = info ?? (await readDeviceFirmwareInfo(connection.server));
      if (current !== info) setInfo(current);
      const manifest = await fetchFirmwareManifest();
      setLatestVersion(manifest.version);
      // On beta/preview builds the version check is bypassed so testers can
      // always re-flash (same as our other non-main behaviors).
      const evaluation = evaluateFirmwareUpdate(current, manifest, {
        force: isPreviewBuild(),
      });
      if (evaluation.available && evaluation.build) {
        setPendingBuild(evaluation.build);
        setForced(evaluation.reason === "forced");
        setConfirmOpen(true);
        return;
      }
      switch (evaluation.reason) {
        case "up-to-date":
          toast.success(`Firmware is up to date (v${current.version})`);
          break;
        case "no-version":
          toast.error("Couldn't read the device's firmware version");
          break;
        case "no-build":
          toast.error("No firmware build is available for this device");
          break;
      }
    } catch (e) {
      toast.error(`Update check failed: ${errorMessage(e)}`);
    } finally {
      setChecking(false);
    }
  }, [connection, info]);

  const cancel = useCallback(() => {
    setConfirmOpen(false);
    setPendingBuild(null);
    setForced(false);
  }, []);

  const startUpdate = useCallback(async () => {
    if (!connection || !pendingBuild) return;
    const build = pendingBuild;
    setConfirmOpen(false);
    setFlashError(null);
    setPercent(0);
    setFlashingLocal(true);
    setFlashing(true);
    let installing = false;

    try {
      // 0. Download the image (prefer the raw .bin), compute its CRC, and verify
      //    against the manifest's published size/CRC — the first link of the
      //    full-circle CRC chain (catches a corrupt download before the device
      //    is involved). Falls back to unzipping the dfuZip for older manifests.
      setPhase("downloading");
      let image: Uint8Array;
      if (build.appBin) {
        fwLog("downloading raw .bin", build.name, build.appBin);
        image = new Uint8Array(await fetchFirmwarePackage(build.appBin));
      } else {
        fwLog("downloading dfuZip", build.name, build.dfuZip);
        image = (await parseDfuPackage(await fetchFirmwarePackage(build.dfuZip))).image;
      }
      const crc = crc32Hex(image);
      assertImageMatchesBuild(build, image, crc);
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
      setPhase("error");
      setFlashError(errorMessage(e));
      setNeedsDisconnect(installing);
      setFlashing(false);
      toast.error(`Firmware update failed: ${errorMessage(e)}`);
    } finally {
      setFlashingLocal(false);
    }
  }, [connection, pendingBuild, setFlashing]);

  /** Dismiss the error state; drops the connection if the device had rebooted. */
  const dismiss = useCallback(() => {
    setPhase(null);
    setFlashError(null);
    setPercent(0);
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
    forced,
    confirmOpen,
    flashing,
    phase,
    percent,
    flashError,
    checkForUpdates,
    cancel,
    startUpdate,
    dismiss,
    finish,
  };
}
