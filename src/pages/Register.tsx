import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Gauge, ArrowLeft } from 'lucide-react';
import { useDocumentHead } from '@/hooks/useDocumentHead';
import { Turnstile, turnstileEnabled } from '@/components/Turnstile';
import { PricingCards } from '@/components/PricingCards';
import { PlanCheckout, PlanCheckoutSummary, type PlanSelection } from '@/components/PlanCheckout';
import { useStripePrices } from '@/hooks/useStripePrices';
import { isDisposableEmail, looksLikeEmail } from '@/lib/emailValidation';
import { isPaidTier } from '@/lib/billing';
import { setPendingCheckout } from '@/lib/pendingCheckout';

// Google sign-in is gated separately: it currently routes through Lovable's OAuth
// broker, so it stays off until native Supabase Google OAuth is configured.
const enableGoogleAuth = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';

export default function Register() {
  const { t } = useTranslation('auth');
  useDocumentHead({
    title: t('register.metaTitle'),
    description: t('register.metaDescription'),
    canonical: 'https://hackthetrack.net/register',
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanSelection>({ tier: 'free', interval: 'monthly' });
  const [confirmAge, setConfirmAge] = useState(false);
  const { signUp, signInWithGoogle } = useAuth();
  const { config } = useStripePrices();
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      toast({ title: t('register.invalidEmail'), variant: 'destructive' });
      return;
    }
    if (isDisposableEmail(email)) {
      toast({ title: t('register.disposableEmail'), description: t('register.disposableEmailDesc'), variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: t('register.passwordsNoMatch'), variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: t('register.passwordTooShort'), variant: 'destructive' });
      return;
    }
    if (turnstileEnabled && !captchaToken) {
      toast({ title: t('register.completeCaptcha'), variant: 'destructive' });
      return;
    }
    if (!confirmAge) {
      toast({ title: t('register.confirmAgeRequired'), variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    // No display name at sign-up — the server auto-assigns a free random name the
    // user can change (and reserve) later from their profile.
    const { error } = await signUp(email, password, undefined, captchaToken ?? undefined);
    setIsLoading(false);
    if (error) {
      toast({ title: t('register.failed'), description: error.message, variant: 'destructive' });
    } else {
      // Account-first paid flow: stash the chosen plan so checkout resumes on
      // the user's first sign-in after confirming their email.
      if (isPaidTier(plan.tier)) {
        setPendingCheckout(plan.tier, plan.interval);
        toast({
          title: t('register.accountCreated'),
          description: t('register.accountCreatedCheckout'),
        });
      } else {
        toast({ title: t('register.accountCreated'), description: t('register.accountCreatedConfirm') });
      }
      navigate('/login');
    }
  };

  const handleGoogle = async () => {
    if (!confirmAge) {
      toast({ title: t('register.confirmAgeRequired'), variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setIsLoading(false);
      toast({ title: t('googleFailed'), description: error.message, variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-8 gap-12">
      <div className="flex items-center gap-3 justify-center mt-4">
        <Gauge className="w-8 h-8 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">HackTheTrack.net</h1>
      </div>

      <PricingCards className="w-full max-w-3xl" variant="register" />

      <div className="w-full max-w-sm space-y-6">
        <div className="racing-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('register.heading')}</h2>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('register.confirmPassword')}</Label>
              <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            </div>
            <PlanCheckout value={plan} onChange={setPlan} config={config} />
            <Turnstile onToken={setCaptchaToken} className="flex justify-center" />
            <label htmlFor="confirmAge" className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                id="confirmAge"
                type="checkbox"
                checked={confirmAge}
                onChange={e => setConfirmAge(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
              />
              <span>
                <Trans
                  t={t}
                  i18nKey="register.ageConfirm"
                  components={{
                    terms: <Link to="/terms" className="text-primary hover:underline" />,
                    privacy: <Link to="/privacy" className="text-primary hover:underline" />,
                  }}
                />
              </span>
            </label>
            <div className="flex items-center gap-3">
              <PlanCheckoutSummary value={plan} config={config} />
              <Button type="submit" className="flex-1" disabled={isLoading || !confirmAge}>
                {isLoading ? t('pleaseWait') : t('register.submit')}
              </Button>
            </div>
          </form>

          {enableGoogleAuth && (
            <>
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-border" />
                <span className="mx-3 text-xs text-muted-foreground">{t('or')}</span>
                <div className="flex-grow border-t border-border" />
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={isLoading}>
                {t('continueWithGoogle')}
              </Button>
            </>
          )}

          <p className="text-sm text-muted-foreground text-center">
            {t('register.alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-primary hover:underline">{t('register.signIn')}</Link>
          </p>
        </div>

        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> {t('backToHome')}
        </Button>
      </div>
    </div>
  );
}
