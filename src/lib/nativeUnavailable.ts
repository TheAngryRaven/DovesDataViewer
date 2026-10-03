/**
 * "This shell can't do that" — the one classifier every optional native
 * (LapWing shell) feature uses to decide between falling back quietly and
 * surfacing an error.
 *
 * Two shapes mean unavailable:
 * - the shell's own sentinel: a rejection prefixed `unsupported:` (a desktop
 *   stub, or an Android build without the feature's SDK);
 * - Tauri refusing the invoke because the command doesn't exist in this
 *   (older) shell — `Command <name> not found`, an `unknown command`, or an
 *   ACL denial (`<name> not allowed…`).
 *
 * Deliberately narrow: a command that ran and failed (`no stored video for
 * key …`, `file not found`, `unknown error`) is a real error the caller must
 * report, not a reason to silently take another path.
 */

const MISSING_COMMAND = /\bcommand\s+\S+\s+not\s+found\b|\bunknown\s+command\b|^\S+\s+not\s+allowed\b/i;

export function isNativeFeatureUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith("unsupported:") || MISSING_COMMAND.test(msg);
}
