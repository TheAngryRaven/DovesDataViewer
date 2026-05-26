import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Gauge, ArrowLeft } from 'lucide-react';
import { useDocumentHead } from '@/hooks/useDocumentHead';
import { Turnstile, turnstileEnabled } from '@/components/Turnstile';
import { PricingCards } from '@/components/PricingCards';
import { isDisposableEmail, looksLikeEmail } from '@/lib/emailValidation';

export default function Register() {
  useDocumentHead({
    title: 'Create account — HackTheTrack',
    description: 'Create a HackTheTrack account to sync your telemetry, garage and notes across devices.',
    canonical: 'https://hackthetrack.net/register',
  });
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const { signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      toast({ title: 'Enter a valid email address', variant: 'destructive' });
      return;
    }
    if (isDisposableEmail(email)) {
      toast({ title: 'Please use a permanent email address', description: 'Disposable / temporary mailboxes are not allowed.', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    if (turnstileEnabled && !captchaToken) {
      toast({ title: 'Please complete the captcha', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    const { error } = await signUp(email, password, displayName, captchaToken ?? undefined);
    setIsLoading(false);
    if (error) {
      toast({ title: 'Registration failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Account created', description: 'Check your email to confirm your account.' });
      navigate('/login');
    }
  };

  const handleGoogle = async () => {
    setIsLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setIsLoading(false);
      toast({ title: 'Google sign-in failed', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center p-8 gap-10">
      <div className="flex items-center gap-3 justify-center mt-4">
        <Gauge className="w-8 h-8 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">HackTheTrack.net</h1>
      </div>

      <PricingCards compact className="w-full max-w-4xl" />

      <div className="w-full max-w-sm space-y-6">
        <div className="racing-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Create account</h2>

          <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={isLoading}>
            Continue with Google
          </Button>
          <div className="relative flex items-center">
            <div className="flex-grow border-t border-border" />
            <span className="mx-3 text-xs text-muted-foreground">or</span>
            <div className="flex-grow border-t border-border" />
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="displayName" type="text" maxLength={40} placeholder="Leave blank for a random name" value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            </div>
            <Turnstile onToken={setCaptchaToken} className="flex justify-center" />
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : 'Create Account'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground text-center">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </div>

        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Button>
      </div>
    </div>
  );
}
