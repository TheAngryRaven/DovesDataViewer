import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_CONFIG, isLocked, recordFailure, type AttemptRow } from "./rateLimit.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// What the caller is telling us happened:
//   • check — about to attempt a login; only report whether the IP is locked.
//   • fail  — a login just failed; record it (and lock once the threshold trips).
//   • reset — a login just succeeded; clear this IP's failure counter.
type Action = "check" | "fail" | "reset";

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Derive IP server-side — never trust a client-provided IP.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               req.headers.get('cf-connecting-ip') || 'unknown';

    const body = await req.json().catch(() => ({}));
    const action: Action =
      body?.action === 'fail' || body?.action === 'reset' ? body.action : 'check';

    // No usable IP — we can't track this client, so never block it.
    if (ip === 'unknown') {
      return json({ allowed: true });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const now = Date.now();

    // Drop expired lockouts so they don't linger (TTL-style reset).
    await supabase
      .from('login_attempts')
      .delete()
      .lt('locked_until', new Date(now).toISOString());

    // A successful login wipes the slate for this IP.
    if (action === 'reset') {
      await supabase.from('login_attempts').delete().eq('ip_address', ip);
      return json({ allowed: true });
    }

    const { data: existing } = await supabase
      .from('login_attempts')
      .select('*')
      .eq('ip_address', ip)
      .maybeSingle();
    const row = existing as AttemptRow | null;

    // Currently locked out? Block regardless of action.
    if (isLocked(row, now)) {
      return json({
        allowed: false,
        locked_until: row!.locked_until,
        message: 'Too many failed attempts. Try again later.',
      });
    }

    // The pre-login check NEVER mutates state — it only reports lock status. This
    // is the core fix: previously every attempt (success included) was counted
    // as a failure here, locking out users who could actually sign in.
    if (action === 'check') {
      return json({ allowed: true });
    }

    // action === 'fail' — record the failed attempt within the sliding window.
    const decision = recordFailure(row, now, DEFAULT_CONFIG);
    if (decision.op.kind === 'insert') {
      await supabase.from('login_attempts').insert({ ip_address: ip, attempts: decision.op.attempts });
    } else {
      await supabase
        .from('login_attempts')
        .update({ attempts: decision.op.attempts, locked_until: decision.op.lockedUntil })
        .eq('ip_address', ip);
    }

    return json(
      decision.allowed
        ? { allowed: true }
        : { allowed: false, locked_until: decision.lockedUntil, message: 'Too many failed attempts. Try again in 1 hour.' },
    );
  } catch (e) {
    console.error('check-login-rate error:', e);
    // Fail open — never block login because the limiter itself errored.
    return json({ allowed: true });
  }
});
