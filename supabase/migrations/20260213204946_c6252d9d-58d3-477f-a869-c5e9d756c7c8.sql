-- Drop the unused login_attempts table
DROP TABLE IF EXISTS public.login_attempts;

-- Fix has_role to only allow checking own role (non-admins)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Unauthenticated users always get false
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Non-admins can only check their own role
  IF _user_id != auth.uid() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    ) THEN
      RETURN FALSE;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$$;