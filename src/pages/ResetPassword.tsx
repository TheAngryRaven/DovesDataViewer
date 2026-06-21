import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';
import { BrandLogo } from "@/components/BrandLogo";
import { useDocumentHead } from '@/hooks/useDocumentHead';

/** True when the current page load arrived via a Supabase password-recovery link. */
function hashHasRecovery(): boolean {
  if (typeof window === 'undefined') return false;
  // Implicit-flow recovery links carry `#...&type=recovery&...`; the PKCE flow
  // uses `?code=...&type=recovery`. Check both before Supabase strips them.
  return /[?#&]type=recovery(&|$)/.test(window.location.hash + window.location.search);
}

export default function ResetPassword() {
  const { t } = useTranslation('auth');
  useDocumentHead({
    title: t('reset.metaTitle'),
    description: t('reset.metaDescription'),
    canonical: 'https://lapwingdata.com/reset-password',
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Only a session established via a PASSWORD_RECOVERY token may set a new
  // password here. Without this gate, anyone landing on /reset-password with an
  // already-signed-in session (a shared/unattended tab, a stolen token) could
  // reset the account password without proving control of the email — turning
  // session theft into a full account takeover.
  const [recoveryReady, setRecoveryReady] = useState(hashHasRecovery);
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY after it processes the recovery token in
    // the URL. We may mount before or after that, so we both seed from the URL
    // (above) and listen for the event.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryReady) {
      toast({
        title: t('reset.recoveryRequired'),
        description: t('reset.recoveryRequiredDesc'),
        variant: 'destructive',
      });
      return;
    }
    if (password !== confirm) {
      toast({ title: t('reset.passwordsNoMatch'), variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: t('reset.passwordTooShort'), variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);
    if (error) {
      toast({ title: t('reset.updateFailed'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('reset.passwordUpdated'), description: t('reset.passwordUpdatedDesc') });
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <BrandLogo className="w-8 h-8" />
          <h1 className="text-xl font-semibold text-foreground">LapWing</h1>
        </div>
        <div className="racing-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('reset.heading')}</h2>
          {recoveryReady ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">{t('reset.newPassword')}</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{t('reset.confirmNewPassword')}</Label>
                <Input id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t('pleaseWait') : t('reset.submit')}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('reset.recoveryOnlyNote')}
            </p>
          )}
        </div>
        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> {t('backToHome')}
        </Button>
      </div>
    </div>
  );
}
