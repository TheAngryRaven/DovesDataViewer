/**
 * Classification of logger-flow failures into typed categories the download UIs
 * can translate and act on.
 *
 * The native (Tauri) backend rejects with plain strings whose prefix encodes the
 * error category (see `native/ipc.ts`); the web Fledgling path throws
 * DOMException-shaped errors from Web Bluetooth. Both funnel through
 * `classifyLoggerError` so no flow ever renders a raw backend string as its
 * headline — the raw text is preserved verbatim in `detail` for a collapsed
 * "technical details" line.
 *
 * Kept transport-free (no Tauri, no Web Bluetooth imports) so it stays on the
 * eager-safe graph alongside `types.ts`/`progress.ts`.
 */

/** Typed failure category derived from a backend rejection prefix. */
export type LoggerErrorCategory =
  | "unreachable" // device off / out of range / wrong network
  | "permission" // OS Bluetooth permission denied (native Android or web picker)
  | "hung" // link dropped mid-transfer
  | "protocol" // bad data on the wire
  | "unsupported" // feature/platform not available
  | "wifi-declined" // user cancelled the OS Wi-Fi picker (MyChron / Android)
  | "not-connected" // call-ordering bug or the device went away between steps
  | "unknown";

/** The recovery affordance a flow should offer for a failure. */
export type LoggerErrorAction = "retry" | "rescan" | "reconnect" | "none";

/** Which step of a flow failed — drives the recovery action. */
export type LoggerFlowStage = "scan" | "connect" | "download" | "firmware";

/** A classified failure: the category plus the raw message, preserved verbatim. */
export interface ClassifiedLoggerError {
  category: LoggerErrorCategory;
  /** The original backend/browser message, for the collapsed detail line. */
  detail: string;
}

// The backend reports Android BLE/Bluetooth permission denials under the
// `device unreachable:` prefix, so the remainder is sniffed for permission-ish
// wording to split the two (they need very different user guidance).
const PERMISSION_HINT = /permission|denied|not allowed|bluetooth_(scan|connect)|nearby/i;

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).trim();
}

/**
 * Classify a rejection from a logger flow. Accepts `unknown` because the native
 * backend rejects with plain strings while Web Bluetooth throws `Error`s.
 */
export function classifyLoggerError(err: unknown): ClassifiedLoggerError {
  const detail = messageOf(err);
  const lower = detail.toLowerCase();

  if (lower.startsWith("device unreachable:")) {
    const remainder = detail.slice("device unreachable:".length);
    return { category: PERMISSION_HINT.test(remainder) ? "permission" : "unreachable", detail };
  }
  if (lower.startsWith("device hung:")) return { category: "hung", detail };
  if (lower.startsWith("protocol error:")) return { category: "protocol", detail };
  if (lower.startsWith("unsupported:")) return { category: "unsupported", detail };
  if (lower.includes("wi-fi join was declined")) return { category: "wifi-declined", detail };
  if (lower.startsWith("no logger connected")) return { category: "not-connected", detail };

  // Web Bluetooth: the chooser denial / blocked API surface as DOMExceptions.
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { category: "permission", detail };
  }

  return { category: "unknown", detail };
}

/**
 * The recommended recovery affordance for a failure. A failed scan/connect
 * leaves the device list stale (rescan); a failed download keeps the connection
 * plausible (retry the transfer); a declined Wi-Fi join re-drives the OS picker
 * (reconnect); `unsupported` has nothing to retry.
 */
export function recoveryActionFor(
  category: LoggerErrorCategory,
  stage: LoggerFlowStage,
): LoggerErrorAction {
  switch (category) {
    case "unsupported":
      return "none";
    case "wifi-declined":
      return "reconnect";
    case "hung":
      return "reconnect";
    case "not-connected":
      return "rescan";
    case "permission":
    case "unreachable":
      return stage === "scan" || stage === "connect" ? "rescan" : "retry";
    default:
      return stage === "download" || stage === "firmware" ? "retry" : "rescan";
  }
}

/**
 * The `logger`-namespace keys for category headlines, as a literal union so the
 * typed `t()` accepts the result (a plain `string` would fail `tsc -b`).
 */
export type LoggerErrorMessageKey =
  | "errors.unreachable"
  | "errors.permission"
  | "errors.hung"
  | "errors.protocol"
  | "errors.unsupported"
  | "errors.wifiDeclined"
  | "errors.notConnected"
  | "errors.unknown";

/** i18n key (inside the `logger` namespace) for a category's headline. */
export function loggerErrorKey(category: LoggerErrorCategory): LoggerErrorMessageKey {
  switch (category) {
    case "unreachable":
      return "errors.unreachable";
    case "permission":
      return "errors.permission";
    case "hung":
      return "errors.hung";
    case "protocol":
      return "errors.protocol";
    case "unsupported":
      return "errors.unsupported";
    case "wifi-declined":
      return "errors.wifiDeclined";
    case "not-connected":
      return "errors.notConnected";
    default:
      return "errors.unknown";
  }
}

// Tauri 2 rejects an invoke of an unregistered command with a plain string
// naming the command (exact wording varies by version, so match permissively —
// but never a backend-prefixed rejection, which means the command DID run).
const MISSING_COMMAND = /(unknown|not found).*command|command.*(not found|unknown)/i;

/**
 * True when a rejection looks like the Tauri backend simply doesn't have the
 * command (an older native shell). Used to degrade optional native features
 * (firmware update) to "not available in this app version".
 */
export function isMissingCommandError(err: unknown): boolean {
  const detail = messageOf(err);
  if (classifyLoggerError(detail).category !== "unknown") return false;
  return MISSING_COMMAND.test(detail);
}
