/**
 * Reading every track file off a connected logger.
 *
 * Shared by the Device → Tracks tab and the sync wizard so there is one place
 * that knows how the two folders are enumerated — and, more importantly, one
 * place that applies `deviceTrackFileFrom`'s identity rule. A second copy of
 * this loop that keyed files by filename would quietly reintroduce the bug
 * where an imported track never matches the file it came from.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import type { DeviceDetails } from '@/lib/loggers';
import type { Track } from '@/types/racing';
import {
  buildMergedTrackList,
  deviceTrackFileFrom,
  type DeviceTrackFile,
} from '@/lib/deviceTrackSync';
import { buildSyncPlan, type SyncPlan } from '@/lib/deviceSyncPlan';
import type { ReservedShortName } from '@/lib/deviceSyncWizard';

export interface FetchProgress {
  current: number;
  total: number;
  /** The filename being read, for a status line. */
  label: string;
}

async function readFolder(
  details: DeviceDetails,
  kind: TrackKind,
  onProgress?: (p: FetchProgress) => void,
): Promise<DeviceTrackFile[]> {
  const names = await details.listTracks(kind);
  const files: DeviceTrackFile[] = [];
  for (let i = 0; i < names.length; i++) {
    const fn = names[i];
    onProgress?.({ current: i + 1, total: names.length, label: fn });
    try {
      const raw = await details.getTrack(fn, kind);
      files.push(deviceTrackFileFrom(fn, new TextDecoder().decode(raw), kind));
    } catch (err) {
      // One unreadable file shouldn't cost the user the whole listing.
      console.error(`Failed to download ${kind} track ${fn}:`, err);
    }
  }
  return files;
}

/**
 * Every track file on the device, both folders.
 *
 * Sprint is reached by the `TS*` verbs; a transport that can't get there
 * reports `supportsSprintTracks: false` and is skipped entirely, so a missing
 * capability never looks like an empty folder. A sprint listing that fails is
 * logged and swallowed — the circuit list is already loaded and worth showing.
 */
export async function fetchDeviceTrackFiles(
  details: DeviceDetails,
  onProgress?: (p: FetchProgress) => void,
): Promise<DeviceTrackFile[]> {
  const files = await readFolder(details, 'circuit', onProgress);
  if (details.supportsSprintTracks) {
    try {
      files.push(...(await readFolder(details, 'sprint', onProgress)));
    } catch (err) {
      console.error('Sprint track list failed:', err);
    }
  }
  return files;
}

export interface DeviceSyncSnapshot {
  plan: SyncPlan;
  /**
   * Short names held by tracks the plan isn't touching. The wizard needs these
   * so a rename can't land on an already-synced track's file.
   */
  reserved: ReservedShortName[];
  files: DeviceTrackFile[];
}

/** Read the device and work out what a sync would do, in one call. */
export async function buildDeviceSyncSnapshot(
  details: DeviceDetails,
  appTracks: Track[],
  onProgress?: (p: FetchProgress) => void,
): Promise<DeviceSyncSnapshot> {
  const files = await fetchDeviceTrackFiles(details, onProgress);
  const merged = buildMergedTrackList(appTracks, files);
  const plan = buildSyncPlan(merged, {
    supportsSprintTracks: details.supportsSprintTracks,
  });

  const inPlan = new Set(plan.rows.map((r) => r.key));
  const reserved: ReservedShortName[] = merged
    .filter((m) => !inPlan.has(`${m.kind}:${m.shortName}`))
    .map((m) => ({ kind: m.kind, shortName: m.shortName }));

  return { plan, reserved, files };
}
