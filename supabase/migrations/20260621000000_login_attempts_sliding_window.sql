-- Failed-login rate limiting now counts failures in a sliding time window
-- instead of forever. Add a last-activity timestamp (maintained by the shared
-- update_updated_at_column() trigger) so the check-login-rate edge function can
-- age out stale, sub-threshold failures. Additive + idempotent.

ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS set_login_attempts_updated_at ON public.login_attempts;
CREATE TRIGGER set_login_attempts_updated_at
  BEFORE UPDATE ON public.login_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
