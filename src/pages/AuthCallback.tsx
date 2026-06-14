import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * OAuth + email-confirm landing page. Lovable's managed OAuth flow has
 * already set the session by the time we get here; we just wait for
 * onAuthStateChange (or an existing session) and bounce to ?next= or /.
 */
export default function AuthCallback() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const next = params.get('next') || '/';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      navigate(next, { replace: true });
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) finish();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) finish();
    });

    const timeout = setTimeout(finish, 4000);
    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [navigate, params]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> {t('callback.signingIn')}
      </div>
    </div>
  );
}
