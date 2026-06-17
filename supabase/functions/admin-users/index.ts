import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Comp grants are bounded so a fat-fingered admin can't hand out a decade.
const MAX_GRANT_MONTHS = 36;
const COMP_TIER = 'premium';
// Days a comp's logs are kept after it expires before trim_expired_logs() reclaims
// them — mirrors the Stripe-cancellation grace (GRACE_DAYS in stripe-webhook).
const GRACE_DAYS = 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Add whole calendar months to a date (clamps to month end, like Stripe). */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

interface SubRow {
  user_id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end?: boolean | null;
  stripe_subscription_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Verify the caller is an admin ──────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } =
      await supabaseAuth.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('id')
      .eq('user_id', claims.claims.sub)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleRow) return json({ error: 'Admin access required' }, 403);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action: string = body.action ?? 'list';

    // ── List users with subscription + storage usage ───────────────────────
    if (action === 'list') {
      const page = Math.max(1, Number(body.page) || 1);
      const perPage = Math.min(100, Math.max(1, Number(body.perPage) || 50));

      const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ page, perPage });
      if (listErr) throw listErr;
      const users = listed.users;
      const ids = users.map((u) => u.id);

      // Resolve display names, subscriptions, and a contribution count in bulk.
      const [{ data: profiles }, { data: subs }, { data: tiers }, { data: subRows }] = await Promise.all([
        admin.from('profiles').select('user_id, display_name').in('user_id', ids),
        admin.from('user_subscriptions').select('*').in('user_id', ids),
        admin.from('subscription_tiers').select('tier, label, total_bytes'),
        admin.from('submissions').select('submitted_by_user_id').in('submitted_by_user_id', ids),
      ]);

      const nameById = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name as string]));
      const subById = new Map((subs ?? []).map((s) => [s.user_id, s as SubRow]));
      const tierByName = new Map((tiers ?? []).map((t) => [t.tier, t]));
      const freeBytes = Number(tierByName.get('free')?.total_bytes ?? 52428800);
      const submissionCount = new Map<string, number>();
      for (const row of subRows ?? []) {
        const id = (row as { submitted_by_user_id: string | null }).submitted_by_user_id;
        if (id) submissionCount.set(id, (submissionCount.get(id) ?? 0) + 1);
      }

      // Usage is a per-user SECURITY DEFINER sum; do the page's worth in parallel.
      const usage = await Promise.all(
        ids.map((id) => admin.rpc('total_storage_used', { p_user: id }).then((r) => Number(r.data ?? 0))),
      );
      const usedById = new Map(ids.map((id, i) => [id, usage[i]]));

      const now = Date.now();
      const rows = users.map((u) => {
        const sub = subById.get(u.id);
        // Mirror user_tier(): a comp (no Stripe id) only counts until it expires.
        const active = sub
          && ['active', 'trialing', 'past_due'].includes(sub.status)
          && (sub.stripe_subscription_id
            || !sub.current_period_end
            || new Date(sub.current_period_end).getTime() > now);
        const effectiveTier = active ? sub!.tier : 'free';
        const isComp = !!sub && !sub.stripe_subscription_id && effectiveTier !== 'free';
        return {
          user_id: u.id,
          email: u.email ?? null,
          display_name: nameById.get(u.id) ?? null,
          created_at: u.created_at,
          tier: effectiveTier,
          tier_label: tierByName.get(effectiveTier)?.label ?? effectiveTier,
          status: sub?.status ?? null,
          current_period_end: sub?.current_period_end ?? null,
          is_comp: isComp,
          has_stripe: !!sub?.stripe_subscription_id,
          used_bytes: usedById.get(u.id) ?? 0,
          limit_bytes: Number(tierByName.get(effectiveTier)?.total_bytes ?? freeBytes),
          submission_count: submissionCount.get(u.id) ?? 0,
        };
      });

      return json({ users: rows, page, perPage, hasMore: users.length === perPage });
    }

    // ── Grant N free months of the comp tier ───────────────────────────────
    if (action === 'grant_premium') {
      const userId: string = body.user_id;
      const months = Math.floor(Number(body.months));
      if (!userId) return json({ error: 'user_id required' }, 400);
      if (!Number.isFinite(months) || months < 1 || months > MAX_GRANT_MONTHS) {
        return json({ error: `months must be between 1 and ${MAX_GRANT_MONTHS}` }, 400);
      }

      const { data: existing } = await admin
        .from('user_subscriptions').select('*').eq('user_id', userId).maybeSingle();
      const cur = existing as SubRow | null;
      if (cur?.stripe_subscription_id) {
        return json({ error: 'User has a Stripe subscription — manage it in Stripe.' }, 409);
      }

      // Extend an unexpired comp; otherwise start from now.
      const now = new Date();
      const base = cur?.current_period_end && new Date(cur.current_period_end) > now
        ? new Date(cur.current_period_end) : now;
      const end = addMonths(base, months);
      // Logs survive GRACE_DAYS past the comp's end, then trim_expired_logs() runs.
      const graceUntil = new Date(end.getTime() + GRACE_DAYS * 86_400_000);

      const { error: upErr } = await admin.from('user_subscriptions').upsert({
        user_id: userId,
        tier: COMP_TIER,
        status: 'active',
        current_period_end: end.toISOString(),
        grace_until: graceUntil.toISOString(),
        cancel_at_period_end: true,
        updated_at: now.toISOString(),
      }, { onConflict: 'user_id' });
      if (upErr) throw upErr;

      return json({ ok: true, tier: COMP_TIER, current_period_end: end.toISOString() });
    }

    // ── Remove a comp grant (never touches a Stripe subscription) ───────────
    if (action === 'clear_grant') {
      const userId: string = body.user_id;
      if (!userId) return json({ error: 'user_id required' }, 400);

      const { data: existing } = await admin
        .from('user_subscriptions').select('stripe_subscription_id').eq('user_id', userId).maybeSingle();
      if (!existing) return json({ ok: true });
      if ((existing as { stripe_subscription_id: string | null }).stripe_subscription_id) {
        return json({ error: 'User has a Stripe subscription — manage it in Stripe.' }, 409);
      }
      const { error: delErr } = await admin
        .from('user_subscriptions').delete().eq('user_id', userId);
      if (delErr) throw delErr;
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('admin-users error:', e);
    return json({ error: 'An error occurred. Please try again later.' }, 500);
  }
});
