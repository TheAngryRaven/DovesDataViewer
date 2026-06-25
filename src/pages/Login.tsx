import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Shield, FileText } from 'lucide-react';
import { BrandHeader } from "@/components/BrandHeader";
import { useDocumentHead } from '@/hooks/useDocumentHead';

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';

export default function Login() {
  const { t } = useTranslation(['auth', 'landing']);
  useDocumentHead({
    title: t('login.metaTitle'),
    description: t('login.metaDescription'),
    canonical: 'https://lapwingdata.com/login',
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      // Pre-check only reports whether this IP is locked — it never counts an
      // attempt. The failure/success is recorded after the login resolves below.
      const { data: rateCheck } = await supabase.functions.invoke('check-login-rate', { body: { action: 'check' } });
      if (rateCheck && !rateCheck.allowed) {
        toast({ title: t('login.tooManyAttempts'), description: rateCheck.message || t('login.tooManyAttemptsDesc'), variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      const { error } = await login(email, password);
      if (error) {
        // Record the failed attempt (best-effort) so brute force still trips the lock.
        void supabase.functions.invoke('check-login-rate', { body: { action: 'fail' } });
        toast({ title: t('login.failed'), description: error.message, variant: 'destructive' });
      } else {
        // Success clears this IP's failure counter.
        void supabase.functions.invoke('check-login-rate', { body: { action: 'reset' } });
        toast({ title: t('login.signedIn') });
        navigate(next);
      }
    } catch {
      toast({ title: t('login.failed'), description: t('login.unexpectedError'), variant: 'destructive' });
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-x">
      <BrandHeader />
      <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="racing-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('login.heading')}</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('pleaseWait') : t('login.submit')}
            </Button>
          </form>

          <div className="flex justify-between text-sm">
            {enableCloud ? (
              <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground transition-colors">
                {t('login.forgotPassword')}
              </Link>
            ) : <span />}
            {enableCloud && (
              <Link to="/register" className="text-primary hover:underline">
                {t('login.createAccount')}
              </Link>
            )}
          </div>
        </div>

        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> {t('backToHome')}
        </Button>

        <div className="flex items-center justify-center gap-6">
          <Link to="/privacy" className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <Shield className="w-3 h-3" />
            {t('landing:links.privacy')}
          </Link>
          <Link to="/terms" className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <FileText className="w-3 h-3" />
            {t('landing:links.terms')}
          </Link>
        </div>
      </div>
      </div>
    </div>
  );
}
