import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbBannedIp } from '@/lib/db/types';
import { Plus, Trash2 } from 'lucide-react';

export function BannedIpsTab() {
  const { t } = useTranslation('admin');
  const [ips, setIps] = useState<DbBannedIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  // Default to a 90-day TTL (data minimisation) rather than a permanent ban.
  const [newDurationDays, setNewDurationDays] = useState('90');

  const db = getDatabase();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIps(await db.getBannedIps());
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [db, t]);

  useEffect(() => { load(); }, [load]);

  const handleBan = async () => {
    if (!newIp.trim()) return;
    try {
      const days = Number(newDurationDays);
      const expiresAt = days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : undefined;
      await db.banIp(newIp.trim(), newReason.trim() || undefined, expiresAt);
      setNewIp(''); setNewReason(''); setNewDurationDays('90'); setShowAdd(false);
      toast({ title: t('bannedIps.banned') });
      load();
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleUnban = async (id: string) => {
    try {
      await db.unbanIp(id);
      toast({ title: t('bannedIps.unbanned') });
      load();
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-foreground">{t('bannedIps.title')}</h3>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4 mr-1" /> {t('bannedIps.banIp')}</Button>
      </div>

      {showAdd && (
        <div className="racing-card p-4 space-y-3">
          <div>
            <Label>{t('bannedIps.ipAddress')}</Label>
            <Input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="192.168.1.1" />
          </div>
          <div>
            <Label>{t('bannedIps.reasonOptional')}</Label>
            <Input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder={t('bannedIps.reasonPlaceholder')} />
          </div>
          <div>
            <Label>{t('bannedIps.expiresAfter')}</Label>
            <select
              value={newDurationDays}
              onChange={e => setNewDurationDays(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="1">{t('bannedIps.duration.oneDay')}</option>
              <option value="7">{t('bannedIps.duration.sevenDays')}</option>
              <option value="30">{t('bannedIps.duration.thirtyDays')}</option>
              <option value="90">{t('bannedIps.duration.ninetyDays')}</option>
              <option value="365">{t('bannedIps.duration.oneYear')}</option>
              <option value="0">{t('bannedIps.duration.permanent')}</option>
            </select>
          </div>
          <Button size="sm" onClick={handleBan}>{t('bannedIps.ban')}</Button>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : ips.length === 0 ? (
        <p className="text-muted-foreground">{t('bannedIps.none')}</p>
      ) : (
        <div className="space-y-2">
          {ips.map(ip => (
            <div key={ip.id} className="racing-card p-3 flex items-center justify-between">
              <div>
                <span className="font-mono text-sm text-foreground">{ip.ip_address}</span>
                {ip.reason && <span className="ml-2 text-xs text-muted-foreground">{ip.reason}</span>}
                {ip.expires_at && <span className="ml-2 text-xs text-muted-foreground">{t('bannedIps.expires', { date: new Date(ip.expires_at).toLocaleString() })}</span>}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleUnban(ip.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
