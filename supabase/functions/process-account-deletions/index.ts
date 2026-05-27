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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Remove every object under `${userId}/` in the private user-files bucket. */
async function removeUserFiles(admin: ReturnType<typeof createClient>, userId: string): Promise<void> {
  const bucket = admin.storage.from(SYNC_BUCKET);
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
        await removeUserFiles(admin, userId);
        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) throw delErr;
        // The account_deletions row is removed by the auth.users FK cascade.
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
