/**
 * Update-application policy (pure, tested).
 *
 * When a newer build is detected the app either applies it immediately
 * (silent reboot onto the new version — with a visible "updating" state
 * so a manual refresh isn't a mystery) or, when the user is mid-work,
 * falls back to the persistent "Update ready" toast.
 *
 * Auto-apply is only allowed when ALL of:
 *  - the user is on the home page (every other route is active use),
 *  - no session is loaded (see lib/appActivity),
 *  - this remote commit hasn't already auto-applied in this tab
 *    (guards against reload loops when an update fails to stick).
 */

export interface UpdateContext {
  pathname: string;
  sessionActive: boolean;
  /** Remote commit already auto-attempted in this tab session. */
  alreadyAutoApplied: boolean;
}

export type UpdateAction = "auto" | "toast";

export function decideUpdateAction(ctx: UpdateContext): UpdateAction {
  if (ctx.alreadyAutoApplied) return "toast";
  if (ctx.sessionActive) return "toast";
  if (ctx.pathname !== "/") return "toast";
  return "auto";
}

/** sessionStorage key remembering which commit an auto-apply rebooted for
 *  (pre-reload), so the fresh load can confirm it and so a failed apply
 *  never loops. */
export const AUTO_APPLIED_KEY = "dove-update-auto-applied";
