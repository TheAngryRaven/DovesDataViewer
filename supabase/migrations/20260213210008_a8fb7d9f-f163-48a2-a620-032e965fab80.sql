-- Explicit deny-all policy: login_attempts is service-role only (used by check-login-rate edge function)
CREATE POLICY "Deny all direct access to login_attempts"
  ON public.login_attempts
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.login_attempts IS 'Service role only - accessed exclusively by check-login-rate edge function. RLS enabled as defense-in-depth.';
