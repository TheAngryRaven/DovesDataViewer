import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Gift, RotateCcw, ChevronDown, ChevronRight, HardDrive, Mail, Route as RouteIcon } from 'lucide-react';

interface AdminUserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  tier: string;
  tier_label: string;
  status: string | null;
  current_period_end: string | null;
  is_comp: boolean;
  has_stripe: boolean;
  used_bytes: number;
  limit_bytes: number;
  submission_count: number;
}

/** Compact byte formatter (no external dep — admin chunk only). */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Invoke the admin-users edge function, surfacing its JSON error body. */
async function invokeAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      const j = await ctx?.json?.();
      if (j?.error) msg = j.error;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return data as T;
}

export function UsersTab() {
  const { t } = useTranslation('admin');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [grantMonths, setGrantMonths] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number, append: boolean) => {
    setLoading(true);
    try {
      const res = await invokeAdmin<{ users: AdminUserRow[]; hasMore: boolean }>({ action: 'list', page: targetPage });
      setUsers(prev => append ? [...prev, ...res.users] : res.users);
      setHasMore(res.hasMore);
      setPage(targetPage);
    } catch (e: unknown) {
      toast({ title: t('users.loadError'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(1, false); }, [load]);

  const grant = async (u: AdminUserRow) => {
    const months = Math.floor(Number(grantMonths[u.user_id] ?? '1'));
    if (!Number.isFinite(months) || months < 1) {
      toast({ title: t('users.invalidMonths'), variant: 'destructive' });
      return;
    }
    setBusy(u.user_id);
    try {
      await invokeAdmin({ action: 'grant_premium', user_id: u.user_id, months });
      toast({ title: t('users.granted', { count: months }) });
      await load(1, false);
    } catch (e: unknown) {
      toast({ title: t('users.grantFailed'), description: (e as Error).message, variant: 'destructive' });
    }
    setBusy(null);
  };

  const clearGrant = async (u: AdminUserRow) => {
    setBusy(u.user_id);
    try {
      await invokeAdmin({ action: 'clear_grant', user_id: u.user_id });
      toast({ title: t('users.grantRemoved') });
      await load(1, false);
    } catch (e: unknown) {
      toast({ title: t('users.grantFailed'), description: (e as Error).message, variant: 'destructive' });
    }
    setBusy(null);
  };

  const tierBadgeClass = (u: AdminUserRow) =>
    u.tier === 'free'
      ? 'bg-muted text-muted-foreground'
      : u.is_comp
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-primary/20 text-primary';

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t('users.title')}</h2>
        <Button variant="outline" size="sm" onClick={() => load(1, false)}>{t('users.refresh')}</Button>
      </div>

      {loading && users.length === 0 ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground">{t('users.none')}</p>
      ) : (
        <div className="space-y-2">
          {users.map(u => {
            const isOpen = expanded === u.user_id;
            const overLimit = u.used_bytes > u.limit_bytes;
            return (
              <div key={u.user_id} className="racing-card">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : u.user_id)}
                  className="w-full flex items-center gap-3 p-3 text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {u.display_name || u.email || `${u.user_id.slice(0, 8)}…`}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${tierBadgeClass(u)}`}>
                        {u.tier_label}{u.is_comp ? ` · ${t('users.comp')}` : ''}
                      </span>
                      {u.submission_count > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <RouteIcon className="w-3 h-3" /> {t('users.submissions', { count: u.submission_count })}
                        </span>
                      )}
                    </div>
                    {u.email && <span className="text-xs text-muted-foreground truncate block">{u.email}</span>}
                  </div>
                  <div className={`text-xs shrink-0 text-right ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                    <div className="flex items-center gap-1 justify-end"><HardDrive className="w-3 h-3" /> {formatBytes(u.used_bytes)}</div>
                    <div>{t('users.ofLimit', { limit: formatBytes(u.limit_bytes) })}</div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border p-3 space-y-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" /> {u.email || t('users.noEmail')}</div>
                      <div className="text-muted-foreground">{t('users.userId')}: <span className="font-mono">{u.user_id}</span></div>
                      <div className="text-muted-foreground">{t('users.created')}: {new Date(u.created_at).toLocaleDateString()}</div>
                      <div className="text-muted-foreground">{t('users.statusLabel')}: {u.status || t('users.statusFree')}</div>
                      {u.current_period_end && (
                        <div className="text-muted-foreground">{t('users.renewsOrEnds')}: {new Date(u.current_period_end).toLocaleDateString()}</div>
                      )}
                      <div className="text-muted-foreground">{t('users.usage')}: {formatBytes(u.used_bytes)} / {formatBytes(u.limit_bytes)}</div>
                    </div>

                    {u.has_stripe ? (
                      <p className="text-xs text-muted-foreground italic">{t('users.stripeManaged')}</p>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">{t('users.grantLabel')}</span>
                        <Input
                          type="number"
                          min={1}
                          max={36}
                          value={grantMonths[u.user_id] ?? '1'}
                          onChange={e => setGrantMonths(prev => ({ ...prev, [u.user_id]: e.target.value }))}
                          className="w-20 h-8 text-sm"
                        />
                        <span className="text-xs text-muted-foreground">{t('users.months')}</span>
                        <Button size="sm" disabled={busy === u.user_id} onClick={() => grant(u)} className="gap-1">
                          <Gift className="w-3 h-3" /> {t('users.grantPremium')}
                        </Button>
                        {u.is_comp && (
                          <Button size="sm" variant="outline" disabled={busy === u.user_id} onClick={() => clearGrant(u)} className="gap-1">
                            <RotateCcw className="w-3 h-3" /> {t('users.removeGrant')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {hasMore && (
            <Button variant="outline" className="w-full" disabled={loading} onClick={() => load(page + 1, true)}>
              {t('users.loadMore')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
