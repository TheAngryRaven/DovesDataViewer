// Pure assembly of a GDPR data-export bundle's *text* entries (JSON + README).
// File blobs (cloud + local) are binary and get added by the orchestrator
// (accountExport.ts); keeping this layer pure makes the manifest unit-testable
// without a browser, IndexedDB, or the Supabase client.

/** Server-side export document returned by the export-account-data function. */
export interface CloudExport {
  export_version?: number;
  exported_at?: string;
  account?: unknown;
  profile?: unknown;
  subscription?: unknown;
  roles?: unknown;
  pending_deletion?: unknown;
  cloud_files?: Array<{ name: string }>;
  garage_records?: unknown;
  contact_messages?: unknown;
}

/** Local browser data gathered by the orchestrator. */
export interface LocalExport {
  settings: unknown;
  /** Document stores (IndexedDB + the localStorage tracks), keyed by store name. */
  stores: Record<string, unknown[]>;
  /** Names of local session-file blobs (added as binaries separately). */
  fileNames: string[];
}

const pretty = (v: unknown): string => JSON.stringify(v ?? null, null, 2);

/**
 * The text (JSON) entries of the export zip, keyed by their path inside the
 * archive. Binary blobs are added separately by the caller.
 */
export function buildExportTextFiles(cloud: CloudExport | null, local: LocalExport): Record<string, string> {
  const files: Record<string, string> = {};

  if (cloud) {
    files['cloud/account.json'] = pretty(cloud.account);
    files['cloud/profile.json'] = pretty(cloud.profile);
    files['cloud/subscription.json'] = pretty(cloud.subscription);
    files['cloud/roles.json'] = pretty(cloud.roles ?? []);
    files['cloud/garage-records.json'] = pretty(cloud.garage_records ?? []);
    files['cloud/contact-messages.json'] = pretty(cloud.contact_messages ?? []);
    files['cloud/cloud-files-index.json'] = pretty(cloud.cloud_files ?? []);
    if (cloud.pending_deletion) {
      files['cloud/pending-deletion.json'] = pretty(cloud.pending_deletion);
    }
  }

  files['local/settings.json'] = pretty(local.settings);
  for (const [store, rows] of Object.entries(local.stores)) {
    files[`local/stores/${store}.json`] = pretty(rows);
  }

  files['README.txt'] = buildReadme(cloud, local);
  return files;
}

export function buildReadme(cloud: CloudExport | null, local: LocalExport): string {
  const localFileCount = local.fileNames.length;
  const cloudFileCount = cloud?.cloud_files?.length ?? 0;
  const lines = [
    'HackTheTrack / Dove\'s DataViewer — your data export',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This archive contains everything we hold about you, for your records and for',
    'portability (GDPR Article 20). It is yours to keep.',
    '',
    'cloud/    — data stored on our backend under your account (only present if you',
    '            are signed in): your profile, subscription, roles, synced garage',
    '            records, contact messages you sent, and any pending account-deletion',
    '            request. cloud/files/ holds the raw session logs you chose to sync.',
    'local/    — data stored only in this browser on this device: app settings, the',
    '            garage stores (vehicles, setups, notes, custom tracks, …), and',
    '            local/files/ session logs that live only on this device.',
    '',
    `Cloud session files: ${cloudFileCount}`,
    `Local session files: ${localFileCount}`,
    '',
    'JSON files are UTF-8 and can be opened in any text editor. Session logs keep',
    'their original file names and formats (CSV, UBX, etc.).',
  ];
  return lines.join('\n');
}
