import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Gauge, ArrowLeft } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const { login, resetPassword } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Check rate limit before attempting login
      const { data: rateCheck } = await supabase.functions.invoke('check-login-rate', {
        body: { success: false },
      });

      if (rateCheck && !rateCheck.allowed) {
        toast({ title: 'Too many attempts', description: rateCheck.message || 'Please try again later.', variant: 'destructive' });
        setIsLoading(false);
        return;
      }

      const { error } = await login(email, password);

      if (error) {
        toast({ title: 'Login failed', description: error.message, variant: 'destructive' });
      } else {
        // Report success to reset rate limit counter
        await supabase.functions.invoke('check-login-rate', {
          body: { success: true },
        });
        toast({ title: 'Logged in successfully' });
        navigate('/admin');
      }
    } catch {
      toast({ title: 'Login failed', description: 'An unexpected error occurred.', variant: 'destructive' });
    }

    setIsLoading(false);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await resetPassword(email);
    setIsLoading(false);
    if (error) {
      toast({ title: 'Reset failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Check your email', description: 'Password reset link sent.' });
      setIsResetMode(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3 justify-center">
          <Gauge className="w-8 h-8 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">HackTheTrack.net</h1>
        </div>

        <div className="racing-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            {isResetMode ? 'Reset Password' : 'Admin Login'}
          </h2>

          <form onSubmit={isResetMode ? handleReset : handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            {!isResetMode && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : isResetMode ? 'Send Reset Link' : 'Login'}
            </Button>
          </form>

          <div className="flex justify-between text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setIsResetMode(!isResetMode)}
            >
              {isResetMode ? 'Back to login' : 'Forgot password?'}
            </button>
            {import.meta.env.VITE_ENABLE_REGISTRATION === 'true' && (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => navigate('/register')}
              >
                Register
              </button>
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
