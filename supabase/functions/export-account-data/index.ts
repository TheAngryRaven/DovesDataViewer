// Returns everything we hold server-side for the authenticated caller, as one
// JSON document (GDPR access / portability). The client merges this with the
// local browser data and zips it — see the cloud-sync data-export panel.
//
// Runs with the service role so it can also include admin-gated rows the user
// can't read directly (their user_roles, and contact messages they sent by
// email). Every query is still scoped to the caller's own id/email — never a
// blanket export.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const [profile, subscription, roles, syncRecords, messages, pendingDeletion] = await Promise.all([
      admin.from('profiles').select('display_name, created_at, updated_at').eq('user_id', user.id).maybeSingle(),
      admin.from('user_subscriptions').select('tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at').eq('user_id', user.id).maybeSingle(),
      admin.from('user_roles').select('role').eq('user_id', user.id),
      admin.from('sync_records').select('store, record_key, data, updated_at').eq('user_id', user.id),
      user.email
        ? admin.from('messages').select('category, email, message, created_at').eq('email', user.email)
        : Promise.resolve({ data: [] }),
      admin.from('account_deletions').select('requested_at, scheduled_for').eq('user_id', user.id).maybeSingle(),
    ]);

    const records = (syncRecords.data ?? []) as Array<{ store: string; record_key: string; data: unknown; updated_at?: string }>;
    // The file store holds only index rows (size); the raw blobs live in the
    // user-files bucket and the client downloads them directly via its session.
    const cloudFiles = records
      .filter((r) => r.store === 'files')
      .map((r) => ({ name: r.record_key, ...(r.data as Record<string, unknown> ?? {}) }));

    const exportDoc = {
      export_version: 1,
      exported_at: new Date().toISOString(),
      account: {
        user_id: user.id,
        email: user.email ?? null,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at ?? null,
        provider: user.app_metadata?.provider ?? null,
      },
      profile: profile.data ?? null,
      subscription: subscription.data ?? null,
      roles: (roles.data ?? []).map((r: { role: string }) => r.role),
      pending_deletion: pendingDeletion.data ?? null,
      cloud_files: cloudFiles,
      garage_records: records.filter((r) => r.store !== 'files'),
      contact_messages: messages.data ?? [],
    };

    return json(exportDoc);
  } catch (e) {
    console.error('export-account-data error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
