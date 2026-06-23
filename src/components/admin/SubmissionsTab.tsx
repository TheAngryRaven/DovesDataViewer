import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbSubmission } from '@/lib/db/types';
import { Check, X, Layers, Route, User } from 'lucide-react';

/** Mini SVG preview of a submitted track outline. */
function DrawingPreview({ points, size = 64 }: { points: Array<{ lat: number; lon: number }>; size?: number }) {
  if (points.length < 2) return null;
  const padding = 3;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const rangeLat = maxLat - minLat || 0.0001;
  const rangeLon = maxLon - minLon || 0.0001;
  const scale = (size - padding * 2) / Math.max(rangeLat, rangeLon);
  const svgPoints = points.map(p => {
    const x = padding + (p.lon - minLon) * scale;
    const y = padding + (maxLat - p.lat) * scale; // flip Y
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={size} height={size} className="shrink-0 rounded border border-border" style={{ background: 'hsl(var(--muted))' }}>
      <polyline points={svgPoints} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A batch of submissions uploaded together, or a single legacy submission. */
interface SubmissionGroup {
  batchId: string | null;
  items: DbSubmission[];
}

/** Group rows by batch_id, preserving the incoming (created_at desc) order. */
function groupSubmissions(submissions: DbSubmission[]): SubmissionGroup[] {
  const groups: SubmissionGroup[] = [];
  const byBatch = new Map<string, SubmissionGroup>();
  for (const sub of submissions) {
    if (sub.batch_id) {
      let g = byBatch.get(sub.batch_id);
      if (!g) {
        g = { batchId: sub.batch_id, items: [] };
        byBatch.set(sub.batch_id, g);
        groups.push(g);
      }
      g.items.push(sub);
    } else {
      groups.push({ batchId: null, items: [sub] });
    }
  }
  return groups;
}

export function SubmissionsTab() {
  const { t } = useTranslation('admin');
  const [submissions, setSubmissions] = useState<DbSubmission[]>([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  // Resolve submitter user ids → display names so the admin sees who contributed.
  const [namesByUserId, setNamesByUserId] = useState<Record<string, string>>({});

  const db = getDatabase();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getSubmissions(filter === 'all' ? undefined : filter);
      setSubmissions(data);
      const userIds = data.map(s => s.submitted_by_user_id).filter((id): id is string => !!id);
      if (userIds.length > 0) {
        try {
          const profiles = await db.getProfiles(userIds);
          setNamesByUserId(Object.fromEntries(profiles.map(p => [p.user_id, p.display_name])));
        } catch { /* names are a nicety; fall back to the raw id */ }
      }
    } catch (e: unknown) {
      toast({ title: t('submissions.loadError'), description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [filter, db, t]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupSubmissions(submissions), [submissions]);

  // Approve = materialize the submission into the live tracks/courses tables,
  // THEN flag it approved. Materializing first means a bad payload surfaces an
  // error and the submission stays pending rather than being marked approved
  // while the track/course silently never landed.
  const reviewSubmission = async (sub: DbSubmission, status: 'approved' | 'denied') => {
    if (status === 'approved') await db.applySubmission(sub);
    await db.updateSubmission(sub.id, status, reviewNotes[sub.id]);
  };

  const handleAction = async (sub: DbSubmission, status: 'approved' | 'denied') => {
    try {
      await reviewSubmission(sub, status);
      toast({ title: status === 'approved' ? t('submissions.toastApproved') : t('submissions.toastDenied') });
      load();
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleBatchAction = async (items: DbSubmission[], status: 'approved' | 'denied') => {
    const pending = items.filter(s => s.status === 'pending');
    try {
      await Promise.all(pending.map(s => reviewSubmission(s, status)));
      toast({ title: t(status === 'approved' ? 'submissions.batchApproved' : 'submissions.batchDenied', { count: pending.length }) });
      load();
    } catch (e: unknown) {
      toast({ title: t('common.error'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  // Save a submitted drawing onto the matching DB course's layout, so the
  // existing drawings.json export (Tools tab) picks it up. The course must
  // already exist in the DB (matched by track short-name/name + course name).
  const handleApplyDrawing = async (sub: DbSubmission) => {
    const layout = sub.layout_data;
    if (!Array.isArray(layout) || layout.length < 2) return;
    try {
      const [tracks, courses] = await Promise.all([db.getTracks(), db.getAllCourses()]);
      const track = tracks.find(t =>
        (sub.track_short_name && t.short_name === sub.track_short_name) || t.name === sub.track_name);
      const course = track && courses.find(c => c.track_id === track.id && c.name === sub.course_name);
      if (!course) {
        toast({
          title: t('submissions.noMatchingCourse'),
          description: t('submissions.noMatchingCourseDesc'),
          variant: 'destructive',
        });
        return;
      }
      await db.saveLayout(course.id, layout);
      toast({ title: t('submissions.drawingApplied'), description: `${sub.track_name} → ${sub.course_name}` });
    } catch (e: unknown) {
      toast({ title: t('submissions.applyError'), description: (e as Error).message, variant: 'destructive' });
    }
  };

  const renderCard = (sub: DbSubmission) => {
    const layout = Array.isArray(sub.layout_data) ? sub.layout_data : null;
    const hasLayout = sub.has_layout || (layout?.length ?? 0) > 0;
    return (
      <div key={sub.id} className="racing-card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{sub.type}</span>
            <span className="text-sm font-medium text-foreground">{sub.track_name}</span>
            {sub.track_short_name && <span className="text-xs text-muted-foreground">({sub.track_short_name})</span>}
            <span className="text-muted-foreground">→</span>
            <span className="text-sm text-foreground">{sub.course_name}</span>
            {hasLayout && (
              <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">{t('submissions.drawingIncluded')}</span>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${sub.status === 'pending' ? 'bg-accent text-accent-foreground' : sub.status === 'approved' ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'}`}>
            {t(`submissions.status.${sub.status}` as 'submissions.status.pending')}
          </span>
        </div>
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-32">
          {JSON.stringify(sub.course_data, null, 2)}
        </pre>
        {layout && layout.length >= 2 && (
          <div className="flex items-center gap-3">
            <DrawingPreview points={layout} />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('submissions.pointOutline', { count: layout.length })}</p>
              <Button size="sm" variant="outline" onClick={() => handleApplyDrawing(sub)} className="gap-1">
                <Route className="w-3 h-3" /> {t('submissions.applyToLayout')}
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          {sub.submitted_by_user_id ? (
            <span className="flex items-center gap-1 rounded bg-primary/15 text-primary px-2 py-0.5">
              <User className="w-3 h-3" />
              {t('submissions.byUser', { name: namesByUserId[sub.submitted_by_user_id] || `${sub.submitted_by_user_id.slice(0, 8)}…` })}
            </span>
          ) : (
            <span className="rounded bg-muted px-2 py-0.5">{t('submissions.anonymous')}</span>
          )}
          <span>{t('submissions.ipLine', { ip: sub.submitted_by_ip || t('submissions.unknownIp'), date: new Date(sub.created_at).toLocaleString() })}</span>
        </div>
        {sub.status === 'pending' && (
          <div className="flex items-center gap-2 pt-2">
            <Input
              placeholder={t('submissions.reviewNotes')}
              value={reviewNotes[sub.id] || ''}
              onChange={e => setReviewNotes(prev => ({ ...prev, [sub.id]: e.target.value }))}
              className="flex-1 text-sm"
            />
            <Button size="sm" onClick={() => handleAction(sub, 'approved')} className="gap-1">
              <Check className="w-3 h-3" /> {t('submissions.approve')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleAction(sub, 'denied')} className="gap-1">
              <X className="w-3 h-3" /> {t('submissions.deny')}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-4">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">{t('submissions.filterPending')}</SelectItem>
            <SelectItem value="approved">{t('submissions.filterApproved')}</SelectItem>
            <SelectItem value="denied">{t('submissions.filterDenied')}</SelectItem>
            <SelectItem value="all">{t('submissions.filterAll')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>{t('submissions.refresh')}</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : submissions.length === 0 ? (
        <p className="text-muted-foreground">{t('submissions.none')}</p>
      ) : (
        <div className="space-y-4">
          {groups.map(group => {
            // A single, non-batched submission renders bare.
            if (group.items.length === 1 && !group.batchId) {
              return renderCard(group.items[0]);
            }
            const pendingCount = group.items.filter(s => s.status === 'pending').length;
            const tracks = Array.from(new Set(group.items.map(s => s.track_name)));
            return (
              <div key={group.batchId!} className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-sm">
                    <Layers className="w-4 h-4 text-primary" />
                    <span className="font-medium text-foreground">{t('submissions.bulkUpload')}</span>
                    <span className="text-muted-foreground">
                      {t('submissions.bulkSummary', {
                        courses: t('submissions.courseCount', { count: group.items.length }),
                        tracks: t('submissions.trackCount', { count: tracks.length }),
                        date: new Date(group.items[0].created_at).toLocaleString(),
                      })}
                    </span>
                  </div>
                  {pendingCount > 0 && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => handleBatchAction(group.items, 'approved')} className="gap-1">
                        <Check className="w-3 h-3" /> {t('submissions.approveAll', { count: pendingCount })}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleBatchAction(group.items, 'denied')} className="gap-1">
                        <X className="w-3 h-3" /> {t('submissions.denyAll')}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {group.items.map(renderCard)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
