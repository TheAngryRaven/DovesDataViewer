import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbBannedIp } from '@/lib/db/types';
import { Plus, Trash2 } from 'lucide-react';

export function BannedIpsTab() {
  const [ips, setIps] = useState<DbBannedIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');

  const db = getDatabase();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIps(await db.getBannedIps());
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const handleBan = async () => {
    if (!newIp.trim()) return;
    try {
      await db.banIp(newIp.trim(), newReason.trim() || undefined);
      setNewIp(''); setNewReason(''); setShowAdd(false);
      toast({ title: 'IP banned' });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleUnban = async (id: string) => {
    try {
      await db.unbanIp(id);
      toast({ title: 'IP unbanned' });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-foreground">Banned IPs</h3>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4 mr-1" /> Ban IP</Button>
      </div>

      {showAdd && (
        <div className="racing-card p-4 space-y-3">
          <div>
            <Label>IP Address</Label>
            <Input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="192.168.1.1" />
          </div>
          <div>
            <Label>Reason (optional)</Label>
            <Input value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="Spam submissions" />
          </div>
          <Button size="sm" onClick={handleBan}>Ban</Button>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : ips.length === 0 ? (
        <p className="text-muted-foreground">No banned IPs.</p>
      ) : (
        <div className="space-y-2">
          {ips.map(ip => (
            <div key={ip.id} className="racing-card p-3 flex items-center justify-between">
              <div>
                <span className="font-mono text-sm text-foreground">{ip.ip_address}</span>
                {ip.reason && <span className="ml-2 text-xs text-muted-foreground">{ip.reason}</span>}
                {ip.expires_at && <span className="ml-2 text-xs text-muted-foreground">expires: {new Date(ip.expires_at).toLocaleString()}</span>}
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
