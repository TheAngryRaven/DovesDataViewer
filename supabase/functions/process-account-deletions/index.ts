// Hard-deletes accounts whose 7-day grace window has elapsed. Cron-invoked: a
// daily pg_cron job posts here with the shared `x-cron-secret`. Does the
// irreversible work SQL shouldn't: removes the user's Storage objects, then
// deletes the auth user (which cascades profiles, sync_records,
// user_subscriptions, user_roles and the account_deletions row via FKs).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SYNC_BUCKET = 'user-files';
const AVATAR_BUCKET = 'user-avatars';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Remove every object under `${userId}/` in a flat ({userId}/{name}) bucket. */
async function removeUserObjects(
  admin: ReturnType<typeof createClient>,
  bucketId: string,
  userId: string,
): Promise<void> {
  const bucket = admin.storage.from(bucketId);
  // List in pages; the folder is flat ({userId}/{filename}), so one level is enough.
  for (;;) {
    const { data: objects, error } = await bucket.list(userId, { limit: 1000 });
    if (error || !objects || objects.length === 0) return;
    const paths = objects.map((o) => `${userId}/${o.name}`);
    const { error: rmErr } = await bucket.remove(paths);
    if (rmErr) throw rmErr;
    if (objects.length < 1000) return;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron-only: reject anything without the shared secret.
  const secret = Deno.env.get('DELETION_CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'Forbidden' }, 403);
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: due, error } = await admin.rpc('due_account_deletions');
    if (error) throw error;

    const userIds = (due ?? []) as string[];
    const results: Array<{ user_id: string; ok: boolean; error?: string }> = [];

    for (const userId of userIds) {
      try {
        // Delete the auth user FIRST. It cascades profiles, sync_records,
        // user_subscriptions, user_roles and the account_deletions row via FKs.
        // Only once that irreversibly succeeds do we wipe the Storage blobs — so
        // a transient auth-delete failure (429/5xx) leaves a fully intact,
        // still-cancellable account instead of one whose files are already gone
        // but whose rows + deletion window survive (UI would 404 on every file).
        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) throw delErr;

        // Best-effort blob cleanup. The account is already gone, so a failure
        // here only leaks orphaned objects (no row references them) — far less
        // harmful than losing files before the account is confirmed deleted. The
        // user is no longer in due_account_deletions, so log loudly for manual
        // sweeping rather than failing the (successful) deletion.
        // Avatars live in a separate public bucket; public_vehicles rows cascade
        // via FK, but Storage objects are never FK-cascaded, so wipe both folders.
        try {
          await removeUserObjects(admin, SYNC_BUCKET, userId);
          await removeUserObjects(admin, AVATAR_BUCKET, userId);
        } catch (fileErr) {
          console.error('process-account-deletions: blob cleanup failed after delete for', userId, fileErr);
        }
        results.push({ user_id: userId, ok: true });
      } catch (e) {
        console.error('process-account-deletions: failed for', userId, e);
        results.push({ user_id: userId, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ processed: results.length, results });
  } catch (e) {
    console.error('process-account-deletions error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
