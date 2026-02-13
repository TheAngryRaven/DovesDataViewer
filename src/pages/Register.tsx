import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Gauge, ArrowLeft } from 'lucide-react';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    if (password.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + '/login' },
    });
    setIsLoading(false);

    if (error) {
      toast({ title: 'Registration failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Account created', description: 'Check your email to confirm your account.' });
      navigate('/login');
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
          <h2 className="text-lg font-semibold text-foreground">Register</h2>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input id="confirmPassword" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Please wait...' : 'Create Account'}
            </Button>
          </form>

          <p className="text-sm text-muted-foreground text-center">
            Already have an account?{' '}
            <button type="button" className="text-primary hover:underline" onClick={() => navigate('/login')}>
              Login
            </button>
          </p>
        </div>

        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Button>
      </div>
    </div>
  );
}
