import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Gauge, ArrowLeft } from 'lucide-react';
import { useDocumentHead } from '@/hooks/useDocumentHead';

export default function ForgotPassword() {
  const { t } = useTranslation('auth');
  useDocumentHead({
    title: t('forgot.metaTitle'),
    description: t('forgot.metaDescription'),
    canonical: 'https://hackthetrack.net/forgot-password',
  });
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { resetPassword } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await resetPassword(email);
    setIsLoading(false);
    if (error) {
      toast({ title: t('forgot.failed'), description: error.message, variant: 'destructive' });
    } else {
      toast({ title: t('forgot.checkEmail'), description: t('forgot.linkSent') });
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
          <h2 className="text-lg font-semibold text-foreground">{t('forgot.heading')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? t('pleaseWait') : t('forgot.submit')}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground text-center">
            {t('forgot.remembered')}{' '}
            <Link to="/login" className="text-primary hover:underline">{t('forgot.backToSignIn')}</Link>
          </p>
        </div>
        <Button variant="ghost" className="w-full gap-2" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4" /> {t('backToHome')}
        </Button>
      </div>
    </div>
  );
}
