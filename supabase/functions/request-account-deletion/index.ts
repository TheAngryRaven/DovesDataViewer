// Schedules deletion of the authenticated caller's account for 7 days out
// (reversible). The client performs an email-OTP re-verification before calling
// this (so a hijacked session alone can't trigger it via the normal UI); the
// 7-day reversible window is the durable safeguard, and only the service role
// can write the row so the window can't be shortened client-side.
//
// Idempotent: calling again keeps the original schedule (never extends or
// shortens an in-flight request).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GRACE_DAYS = 7;

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

    // Keep an existing request's schedule; only create one if none is pending.
    const { data: existing } = await admin
      .from('account_deletions')
      .select('requested_at, scheduled_for')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      return json({ scheduled_for: existing.scheduled_for, requested_at: existing.requested_at });
    }

    const now = new Date();
    const scheduledFor = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    const { error } = await admin.from('account_deletions').insert({
      user_id: user.id,
      requested_at: now.toISOString(),
      scheduled_for: scheduledFor.toISOString(),
    });
    if (error) throw error;

    return json({ scheduled_for: scheduledFor.toISOString(), requested_at: now.toISOString() });
  } catch (e) {
    console.error('request-account-deletion error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
