import { useCallback, useEffect, useRef, useState } from "react";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { useFirmwareUpdateApi } from "@/contexts/FirmwareUpdateContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { isFirmwareUpdateSnoozed } from "@/lib/firmwareUpdateReminder";
import { buildDeviceSyncSnapshot, type DeviceSyncSnapshot } from "@/lib/deviceSyncFetch";
import { planHasWork } from "@/lib/deviceSyncPlan";
import { loadTracks } from "@/lib/trackStorage";
import { DeviceSyncPrompt, DeviceSyncWizard } from "@/components/drawer/DeviceSyncWizard";

/**
 * What happens the moment a logger connects: offer the firmware update, then
 * offer to sync tracks.
 *
 * Renders nothing until it has something to ask. Mount once inside
 * `DeviceProvider` + `FirmwareUpdateProvider`.
 *
 * **Firmware first**, because accepting it reboots the device and drops the
 * link — anything queued behind it would be thrown away. It is also the rarer
 * of the two, and a "remind me tomorrow" keeps it rare, so most connects reach
 * the track prompt straight away and many show nothing at all.
 *
 * Declining the track prompt is scoped to this connection: there is no stored
 * suppression, and the flow only re-runs when a *new* connection appears. That
 * is deliberate — being asked again after deliberately reconnecting is
 * expected; being asked twice on one connection is nagging.
 */
type Phase = "idle" | "firmware" | "tracks";

export function DeviceConnectFlow() {
  const { connection, details, deviceName } = useDeviceContext();
  const fw = useFirmwareUpdateApi();
  const online = useOnlineStatus();

  const [phase, setPhase] = useState<Phase>("idle");
  const [snapshot, setSnapshot] = useState<DeviceSyncSnapshot | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  // The firmware dialog is owned by the provider, so the only signal that the
  // user has finished with it is `confirmOpen` going back down.
  const sawFirmwareDialog = useRef(false);

  // A new connection restarts the whole flow; losing one abandons it.
  useEffect(() => {
    setPromptOpen(false);
    setWizardOpen(false);
    setSnapshot(null);
    sawFirmwareDialog.current = false;
    setPhase(connection ? "firmware" : "idle");
  }, [connection]);

  // ── Step 1: firmware ──
  useEffect(() => {
    if (phase !== "firmware" || !connection) return;
    let cancelled = false;

    (async () => {
      // The manifest is a network fetch; offline it simply isn't this
      // connection's problem, so move on rather than surface a failure.
      if (!online) {
        if (!cancelled) setPhase("tracks");
        return;
      }
      const offered = await fw.checkForUpdates({
        silent: true,
        // Checked against the version actually on offer, so a NEW release asks
        // again immediately instead of inheriting yesterday's snooze.
        suppress: (version) => isFirmwareUpdateSnoozed(deviceName, version),
      });
      if (cancelled) return;
      if (!offered) setPhase("tracks");
    })();

    return () => {
      cancelled = true;
    };
    // `fw` is rebuilt every render; keying on the connection + phase is what
    // makes this run once per connect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, connection, online, deviceName]);

  // Move on once the user is done with the firmware dialog, whichever way.
  useEffect(() => {
    if (phase !== "firmware") return;
    if (fw.confirmOpen) {
      sawFirmwareDialog.current = true;
    } else if (sawFirmwareDialog.current && !fw.flashing && fw.phase === null) {
      sawFirmwareDialog.current = false;
      setPhase("tracks");
    }
  }, [phase, fw.confirmOpen, fw.flashing, fw.phase]);

  // ── Step 2: tracks ──
  useEffect(() => {
    if (phase !== "tracks" || !details) return;
    let cancelled = false;

    (async () => {
      try {
        const tracks = await loadTracks();
        const next = await buildDeviceSyncSnapshot(details, tracks, undefined, {
          deviceName,
          firmwareVersion: fw.info?.version,
        });
        if (cancelled) return;
        // Only interrupt when there is something to do. A prompt that appears
        // on every connect to say "nothing to sync" is worse than silence.
        if (planHasWork(next.plan)) {
          setSnapshot(next);
          setPromptOpen(true);
        }
      } catch (err) {
        // Reading the card failed. The Device → Tracks tab is still there if
        // the user wants to look; an unasked-for check shouldn't shout.
        console.error("Device sync check failed:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, details, deviceName, fw.info?.version]);

  const handleAccept = useCallback(() => {
    setPromptOpen(false);
    setWizardOpen(true);
  }, []);

  const handleDecline = useCallback(() => {
    setPromptOpen(false);
    setSnapshot(null);
  }, []);

  if (!snapshot || !details) return null;

  return (
    <>
      <DeviceSyncPrompt
        open={promptOpen}
        count={snapshot.plan.rows.length}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
      <DeviceSyncWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        plan={snapshot.plan}
        reserved={snapshot.reserved}
        details={details}
        onDone={() => setSnapshot(null)}
      />
    </>
  );
}
