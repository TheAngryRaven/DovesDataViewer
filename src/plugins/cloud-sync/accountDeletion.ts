// Client side of self-service account deletion.
//
// Flow: the user proves control of the account email via a one-time code
// (Supabase Auth email OTP — no extra mail provider needed). The emailed code is
// then passed to the request-account-deletion edge function, which VERIFIES it
// server-side before scheduling deletion 7 days out. Verifying on the server (not
// just in the UI) is what stops a stolen JWT from scheduling deletion via a
// direct call — the caller must also possess the emailed code. The window is
// reversible: cancel deletes the pending row (RLS allows the owner). The
// irreversible purge is done by the process-account-deletions worker once the
// window elapses.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// account_deletions isn't in the generated Database type yet (regenerated after
// the migration deploys), so route it through an untyped view — same pattern as
// cloudClient.ts / billingClient.ts.
const untyped = supabase as unknown as SupabaseClient;

export interface PendingDeletion {
  requested_at: string;
  scheduled_for: string;
}

/** Email a one-time code to the signed-in user's address (re-verification). */
export async function sendDeletionCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw new Error(error.message);
}

/**
 * Schedule deletion (idempotent server-side). The emailed `code` is verified by
 * the edge function — DON'T verify it client-side first or it'll be consumed
 * before the server can check it. Returns the scheduled date.
 */
export async function scheduleAccountDeletion(code: string): Promise<PendingDeletion> {
  const { data, error } = await supabase.functions.invoke("request-account-deletion", {
    body: { code: code.trim() },
  });
  if (error) throw new Error(error.message);
  return data as PendingDeletion;
}

/** The caller's pending deletion request, or null if none. */
export async function getPendingDeletion(userId: string): Promise<PendingDeletion | null> {
  const { data, error } = await untyped
    .from("account_deletions")
    .select("requested_at, scheduled_for")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as PendingDeletion | null;
}

/** Cancel a pending deletion (owner-only via RLS). */
export async function cancelAccountDeletion(userId: string): Promise<void> {
  const { error } = await untyped.from("account_deletions").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}
