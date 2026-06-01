// Schedules deletion of the authenticated caller's account for 7 days out
// (reversible). The caller must supply the email OTP code we mailed them, which
// THIS function verifies server-side before scheduling — so a hijacked session
// (stolen JWT) alone can't trigger deletion via a direct call; it would also
// need the emailed code. Only the service role can write the row, so the 7-day
// window can't be shortened client-side.
//
// Idempotent: if a request already exists we return it without consuming a code
// (it's just a read); creating a new one requires a valid OTP.
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
    // Returning an already-scheduled request is a read, so it needs no OTP.
    const { data: existing } = await admin
      .from('account_deletions')
      .select('requested_at, scheduled_for')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      return json({ scheduled_for: existing.scheduled_for, requested_at: existing.requested_at });
    }

    // Scheduling a NEW deletion requires the emailed OTP, verified here so the
    // JWT alone is not enough. Verify with a fresh anon client (no session).
    const { code } = await req.json().catch(() => ({}));
    if (!code || typeof code !== 'string') {
      return json({ error: 'A verification code is required' }, 400);
    }
    if (!user.email) {
      return json({ error: 'Account has no email to verify against' }, 400);
    }
    const otpClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const { error: otpErr } = await otpClient.auth.verifyOtp({
      email: user.email,
      token: code.trim(),
      type: 'email',
    });
    if (otpErr) {
      return json({ error: 'Invalid or expired verification code' }, 400);
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
