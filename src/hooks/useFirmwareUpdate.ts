import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { BleConnection } from "@/lib/bleDatalogger";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { isPreviewBuild } from "@/lib/buildInfo";
import { isDebugEnabled } from "@/lib/debugConsole";
import {
  connectToDfuDevice,
  evaluateFirmwareUpdate,
  fetchFirmwareManifest,
  fetchFirmwarePackage,
  flashFirmware,
  parseDfuPackage,
  readDeviceFirmwareInfo,
  triggerDfuMode,
  type DeviceFirmwareInfo,
  type FirmwareBuild,
} from "@/lib/ble/dfu";

/** Coarse phase shown in the flashing dialog. */
export type FirmwareFlashPhase =
  | "downloading"
  | "rebooting"
  | "reconnecting"
  | "transferring"
  | "validating"
  | "activating"
  | "done"
  | "error";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Debug log, only when the on-screen console is enabled (?dbg=true). */
function fwLog(...args: unknown[]): void {
  if (isDebugEnabled()) console.info("[firmware]", ...args);
}

/** A Web Bluetooth "Origin is not allowed to access the service" / SecurityError. */
function isServiceAccessError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return name === "SecurityError" || msg.includes("not allowed to access");
}

/** Comma-joined UUIDs of the services this origin can currently access (diagnostic). */
async function listAccessibleServices(server: BluetoothRemoteGATTServer): Promise<string> {
  try {
    const services = await server.getPrimaryServices();
    return services.map((s) => s.uuid).join(", ") || "(none)";
  } catch {
    return "(could not enumerate)";
  }
}

/**
 * Orchestrates the firmware-update flow for a connected logger:
 * read installed version → check the OTA manifest → (on confirm) download,
 * reboot into DFU, reconnect, flash, and auto-disconnect.
 *
 * The actual transfer/manifest/version logic is the unit-tested code in
 * `@/lib/ble/dfu`; this hook is the React state glue around it. Flashing is
 * marked on `DeviceContext` so the expected BLE drop (the reboot into the
 * bootloader) doesn't tear down the UI mid-update.
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
  // After the device has been rebooted into DFU, the app link is dead — closing
  // the dialog must drop the (stale) software connection.
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
    let rebooted = false;

    try {
      setPhase("downloading");
      fwLog("downloading package", build.name, build.dfuZip);
      const zip = await fetchFirmwarePackage(build.dfuZip);
      const pkg = await parseDfuPackage(zip);
      fwLog("package ready", { imageBytes: pkg.image.byteLength });

      setPhase("rebooting");
      fwLog("triggering DFU mode (writing to control point)…");
      await triggerDfuMode(connection.server);
      rebooted = true;

      setPhase("reconnecting");
      fwLog("reconnecting to bootloader…");
      const dfu = await connectToDfuDevice(connection.device);
      fwLog("connected to bootloader; starting transfer");

      await flashFirmware(dfu.transport, pkg, {
        onProgress: (p) => {
          if (p.phase === "transferring") {
            setPhase("transferring");
            setPercent(p.percent);
          } else if (p.phase === "validating") {
            setPhase("validating");
          } else if (p.phase === "activating") {
            setPhase("activating");
          }
        },
      });

      try {
        dfu.server.disconnect();
      } catch {
        // ignore — the device resets itself on activate
      }

      setPhase("done");
      setPercent(100);
      toast.success("Firmware updated — device is rebooting");
      // Auto-disconnect the software side once finished.
      setFlashing(false);
      disconnectDevice();
    } catch (e) {
      fwLog("update failed", { rebooted, name: (e as { name?: string })?.name, error: errorMessage(e) });
      let message = errorMessage(e);
      // A SecurityError on a service we *do* whitelist almost always means a
      // stale browser permission for an already-paired device. Surface what the
      // page can actually access + how to fix it.
      if (isServiceAccessError(e) && !rebooted) {
        const accessible = await listAccessibleServices(connection.server);
        fwLog("accessible services:", accessible);
        message =
          `${errorMessage(e)}\n\n` +
          "Your browser is blocking the firmware-update service — usually a stale " +
          "Bluetooth permission from a previous pairing. Fix: disconnect, then remove " +
          "this device under your browser's Bluetooth permissions " +
          "(chrome://settings/content/bluetoothDevices), reconnect, and try again.\n\n" +
          `Services currently accessible: ${accessible}`;
      }
      setPhase("error");
      setFlashError(message);
      setNeedsDisconnect(rebooted);
      setFlashing(false);
      toast.error(`Firmware update failed: ${errorMessage(e)}`);
    } finally {
      setFlashingLocal(false);
    }
  }, [connection, pendingBuild, setFlashing, disconnectDevice]);

  /** Dismiss the error state; drops the stale connection if we'd rebooted. */
  const dismiss = useCallback(() => {
    setPhase(null);
    setFlashError(null);
    setPercent(0);
    if (needsDisconnect) {
      setNeedsDisconnect(false);
      disconnectDevice();
    }
  }, [needsDisconnect, disconnectDevice]);

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
  };
}
