import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Gauge, ArrowLeft } from 'lucide-react';
import { useDocumentHead } from '@/hooks/useDocumentHead';

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';
// Google sign-in is gated separately: it currently routes through Lovable's OAuth
// broker, so it stays off until native Supabase Google OAuth is configured.
const enableGoogleAuth = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';

export default function Login() {
  useDocumentHead({
    title: 'Sign in — HackTheTrack',
    description: 'Sign in to HackTheTrack to sync your telemetry, garage and notes across devices.',
    canonical: 'https://hackthetrack.net/login',
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { data: rateCheck } = await supabase.functions.invoke('check-login-rate', { body: {} });
      if (rateCheck && !rateCheck.allowed) {
        toast({ title: 'Too many attempts', description: rateCheck.message || 'Please try again later.', variant: 'destructive' });
        setIsLoading(false);
        return;
      }
      const { error } = await login(email, password);
      if (error) {
        toast({ title: 'Login failed', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Signed in' });
        navigate(next);
      }
    } catch {
      toast({ title: 'Login failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    }
    setIsLoading(false);
  };

  const handleGoogle = async () => {
    setIsLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      setIsLoading(false);
      toast({ title: 'Google sign-in failed', description: error.message, variant: 'destructive' });
    }
    // On success the browser redirects to Google; nothing else to do.
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <Gauge className="w-8 h-8 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">HackTheTrack.net</h1>
        </div>

        <div className="racing-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Sign in</h2>

          {enableCloud && enableGoogleAuth && (
            <>
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={isLoading}>
                Continue with Google
              </Button>
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-border" />
                <span className="mx-3 text-xs text-muted-foreground">or</span>
                <div className="flex-grow border-t border-border" />
              </div>
            </>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : 'Sign in'}
            </Button>
          </form>

          <div className="flex justify-between text-sm">
            {enableCloud ? (
              <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground transition-colors">
                Forgot password?
              </Link>
            ) : <span />}
            {enableCloud && (
              <Link to="/register" className="text-primary hover:underline">
                Create account
              </Link>
            )}
          </div>
        </div>

        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Button>
      </div>
    </div>
  );
}
