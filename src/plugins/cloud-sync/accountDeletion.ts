// Client side of self-service account deletion.
//
// Flow: the user proves control of the account email via a one-time code
// (Supabase Auth email OTP — no extra mail provider needed), then we ask the
// request-account-deletion edge function to schedule deletion 7 days out. The
// window is reversible: cancel deletes the pending row (RLS allows the owner).
// Until then the app shows a deletion banner. The irreversible purge is done
// server-side by the process-account-deletions worker once the window elapses.

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

/** Verify the emailed code. Resolves on success; throws on a bad/expired code. */
export async function verifyDeletionCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: "email" });
  if (error) throw new Error(error.message);
}

/** Schedule deletion (idempotent server-side). Returns the scheduled date. */
export async function scheduleAccountDeletion(): Promise<PendingDeletion> {
  const { data, error } = await supabase.functions.invoke("request-account-deletion");
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
