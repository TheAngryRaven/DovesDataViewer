-- Recreate login_attempts table for rate limiting
CREATE TABLE public.login_attempts (
  ip_address text PRIMARY KEY,
  attempts integer DEFAULT 0,
  locked_until timestamp with time zone
);

-- No RLS needed - only accessed via service_role from edge function
COMMENT ON TABLE public.login_attempts IS 'Service role only - accessed exclusively by check-login-rate edge function';