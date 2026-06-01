-- Make stripe_events' "service-role only" posture explicit.
--
-- stripe_events (the webhook idempotency / replay-protection ledger) has RLS
-- enabled but no policy. That is already deny-all for every non-service role —
-- the service role bypasses RLS, so the stripe-webhook function still works —
-- but Supabase's database linter flags it as `rls_enabled_no_policy`, and an
-- empty policy list reads as "someone forgot to add policies" rather than
-- "this is intentional".
--
-- This mirrors the existing login_attempts pattern (20260213210008): an explicit
-- FOR ALL ... USING (false) WITH CHECK (false) policy for authenticated + anon,
-- plus a table comment. No behavioural change — direct client access was already
-- denied — but the intent is now self-documenting and the linter warning clears.

drop policy if exists "Deny all direct access to stripe_events" on public.stripe_events;
create policy "Deny all direct access to stripe_events"
  on public.stripe_events
  for all
  to authenticated, anon
  using (false)
  with check (false);

comment on table public.stripe_events is
  'Service role only - written exclusively by the stripe-webhook edge function for event idempotency. RLS enabled with an explicit deny-all policy as defense-in-depth.';

notify pgrst, 'reload schema';
