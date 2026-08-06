/**
 * Walking a sync operation list.
 *
 * The ordering that makes a partial failure recoverable is decided in
 * `deviceSyncOps`; this only has to honour it, and report honestly when it
 * couldn't finish. Executors are injected so the whole thing is testable
 * without a radio or a browser.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import type { Track } from '@/types/racing';
import type { SyncOperation } from '@/lib/deviceSyncOps';

export interface SyncExecutors {
  devicePut(folder: TrackKind, fileName: string, data: Uint8Array): Promise<void>;
  deviceDelete(folder: TrackKind, fileName: string): Promise<void>;
  appPut(track: Track): Promise<void>;
  appDelete(trackName: string): Promise<void>;
}

export interface SyncProgress {
  /** Operations finished so far, successful or not. */
  done: number;
  total: number;
  /** The track being worked on, for a status line. */
  trackKey: string;
}

export interface SyncFailure {
  operation: SyncOperation;
  message: string;
}

export interface SyncRunResult {
  /** Track keys that completed every one of their operations. */
  succeeded: string[];
  /** Track keys where something failed; each also appears in `failures`. */
  failed: string[];
  failures: SyncFailure[];
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runOne(op: SyncOperation, exec: SyncExecutors): Promise<void> {
  switch (op.type) {
    case 'device_put':
      return exec.devicePut(op.folder, op.fileName, new TextEncoder().encode(op.json));
    case 'device_delete':
      return exec.deviceDelete(op.folder, op.fileName);
    case 'app_put':
      return exec.appPut(op.track);
    case 'app_delete':
      return exec.appDelete(op.trackName);
  }
}

/**
 * Run every operation in order, and keep going after a failure.
 *
 * A failed track **abandons its own remaining operations** — once its file
 * didn't write, deleting the old one would destroy the only copy — but other
 * tracks still run. One track failing to sync is not a reason to leave the
 * other nine untouched, and the operation list is ordered so each track's work
 * is contiguous.
 */
export async function runSyncOperations(
  operations: SyncOperation[],
  exec: SyncExecutors,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncRunResult> {
  const failures: SyncFailure[] = [];
  const failedKeys = new Set<string>();
  const touchedKeys: string[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    if (!touchedKeys.includes(op.trackKey)) touchedKeys.push(op.trackKey);

    // Everything after a failure within the same track is unsafe: the delete
    // would remove the copy the failed write was meant to replace.
    if (failedKeys.has(op.trackKey)) {
      onProgress?.({ done: i + 1, total: operations.length, trackKey: op.trackKey });
      continue;
    }

    try {
      await runOne(op, exec);
    } catch (e) {
      failedKeys.add(op.trackKey);
      failures.push({ operation: op, message: messageOf(e) });
    }
    onProgress?.({ done: i + 1, total: operations.length, trackKey: op.trackKey });
  }

  return {
    succeeded: touchedKeys.filter((k) => !failedKeys.has(k)),
    failed: touchedKeys.filter((k) => failedKeys.has(k)),
    failures,
  };
}
