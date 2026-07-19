// Pure share-state model (plan 0009). A log's share state rides its cloud index
// row (sync_records store='files', data.share):
//   undefined         — never shared; follows the profile default on upload
//   { token }         — published; the shared_sessions row + public blob exist
//   { optedOut: true} — explicitly unshared; auto-publish must never resurrect it

/** The `share` field on a file index row's jsonb data. */
export type FileShareState = { token: string } | { optedOut: true } | undefined;

/** The index-row jsonb payload: size plus the optional share marker. */
export type FileIndexData = { size?: number; share?: FileShareState } & Record<string, unknown>;

/** True when the share field carries a live token. */
export function shareToken(share: FileShareState): string | null {
  return share && "token" in share && share.token ? share.token : null;
}

/**
 * Should a fresh upload auto-publish? Only when the profile default is public
 * AND the file has no share history — an existing token means it's already
 * shared, an opt-out means the user explicitly unshared it.
 */
export function shouldAutoPublish(defaultPublic: boolean, share: FileShareState): boolean {
  return defaultPublic && share === undefined;
}

/**
 * Merge a share state into an index row's data without touching other fields
 * (notably `size`, which the server quota function reads). `null` clears the
 * share field entirely.
 */
export function mergeShareIntoIndexData(
  data: FileIndexData | null | undefined,
  share: FileShareState | null,
): FileIndexData {
  const base: FileIndexData = { ...(data ?? {}) };
  if (share === null) {
    delete base.share;
  } else {
    base.share = share;
  }
  return base;
}

/** The public share URL for a token. */
export function shareUrl(origin: string, token: string): string {
  return `${origin}/s/${token}`;
}

/**
 * Lower-cased extension of a filename (no dot), or "" when it has none.
 * Stored publicly on the share row so the recipient can route the blob to the
 * right parser (binary formats detect by extension) — never the full name.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}
