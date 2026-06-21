// Independent "a newer build is deployed" signal.
//
// The PWA already tries to update itself by polling the service worker
// (`registration.update()` in main.tsx). That relies on the browser noticing a
// byte-diff in `service-worker.js`, which can silently fail behind aggressive
// HTTP / CDN caching — leaving a tab pinned to a stale build. This module is the
// belt to that suspenders: a tiny `version.json` is emitted next to the bundle at
// build time (see vite.config.ts), and the running tab fetches it fresh and
// compares it against the build constants compiled into its own bundle
// (`buildInfo`). The deployed copy is, by definition, "latest".

import { buildInfo, type BuildInfo } from "@/lib/buildInfo";

/** Shape of the build-emitted `/version.json`. Mirrors {@link BuildInfo}. */
export interface RemoteVersion {
  version: string;
  commit: string;
  buildDate: string;
  branch: string;
  commitDate: string;
}

/** Default poll interval — frequent enough to catch a deploy mid-session,
 *  infrequent enough to be invisible. Also re-checked on focus / reconnect. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Pure update check. True only when the remote build is genuinely newer than the
 * running one:
 *  - commit hashes differ (something actually shipped), AND
 *  - the remote build is strictly newer by build timestamp.
 *
 * The timestamp guard keeps us from prompting when the running tab is actually
 * ahead (a rollback, or a local/preview build), and a missing/`"unknown"` hash
 * on either side is never treated as an update.
 */
export function isUpdateAvailable(
  remote: RemoteVersion | null | undefined,
  local: BuildInfo = buildInfo,
): boolean {
  if (!remote) return false;
  if (!remote.commit || remote.commit === "unknown") return false;
  if (!local.commit || local.commit === "unknown") return false;
  if (remote.commit === local.commit) return false;
  if (!remote.buildDate || !local.buildDate) return false;
  return remote.buildDate > local.buildDate;
}

/**
 * Fetch `/version.json` bypassing every cache layer (cache-busting query +
 * `no-store`). Returns `null` on any failure (offline, 404, malformed) so the
 * caller can stay silent rather than surfacing an error.
 */
export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<RemoteVersion>;
    if (!json || typeof json.commit !== "string" || typeof json.buildDate !== "string") {
      return null;
    }
    return json as RemoteVersion;
  } catch {
    return null;
  }
}

/**
 * Start watching for a newer deployed build. Checks immediately, then on an
 * interval and whenever the tab regains focus or the network reconnects.
 * `onUpdate` fires at most once per newly-seen remote commit. Returns a cleanup
 * function that stops all timers/listeners.
 */
export function startVersionPolling(onUpdate: () => void): () => void {
  let notifiedCommit: string | null = null;
  let stopped = false;

  const check = async () => {
    if (stopped || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const remote = await fetchRemoteVersion();
    if (stopped || !remote || !isUpdateAvailable(remote)) return;
    if (notifiedCommit === remote.commit) return;
    notifiedCommit = remote.commit;
    onUpdate();
  };

  const onOnline = () => void check();
  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };

  void check();
  const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
