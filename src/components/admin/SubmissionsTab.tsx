import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbSubmission } from '@/lib/db/types';
import { Check, X, Layers, Route } from 'lucide-react';

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
  const [submissions, setSubmissions] = useState<DbSubmission[]>([]);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const db = getDatabase();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getSubmissions(filter === 'all' ? undefined : filter);
      setSubmissions(data);
    } catch (e: unknown) {
      toast({ title: 'Error loading submissions', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [filter, db]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupSubmissions(submissions), [submissions]);

  const handleAction = async (id: string, status: 'approved' | 'denied') => {
    try {
      await db.updateSubmission(id, status, reviewNotes[id]);
      toast({ title: `Submission ${status}` });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleBatchAction = async (items: DbSubmission[], status: 'approved' | 'denied') => {
    const pending = items.filter(s => s.status === 'pending');
    try {
      await Promise.all(pending.map(s => db.updateSubmission(s.id, status, reviewNotes[s.id])));
      toast({ title: `${pending.length} submission${pending.length !== 1 ? 's' : ''} ${status}` });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
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
          title: 'No matching course',
          description: 'Create the course in the DB first, then apply its drawing.',
          variant: 'destructive',
        });
        return;
      }
      await db.saveLayout(course.id, layout);
      toast({ title: 'Drawing applied', description: `${sub.track_name} → ${sub.course_name}` });
    } catch (e: unknown) {
      toast({ title: 'Error applying drawing', description: (e as Error).message, variant: 'destructive' });
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
              <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">Drawing included</span>
            )}
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${sub.status === 'pending' ? 'bg-accent text-accent-foreground' : sub.status === 'approved' ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'}`}>
            {sub.status}
          </span>
        </div>
        <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-32">
          {JSON.stringify(sub.course_data, null, 2)}
        </pre>
        {layout && layout.length >= 2 && (
          <div className="flex items-center gap-3">
            <DrawingPreview points={layout} />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{layout.length} point outline submitted</p>
              <Button size="sm" variant="outline" onClick={() => handleApplyDrawing(sub)} className="gap-1">
                <Route className="w-3 h-3" /> Apply to course layout
              </Button>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          IP: {sub.submitted_by_ip || 'unknown'} • {new Date(sub.created_at).toLocaleString()}
        </p>
        {sub.status === 'pending' && (
          <div className="flex items-center gap-2 pt-2">
            <Input
              placeholder="Review notes (optional)"
              value={reviewNotes[sub.id] || ''}
              onChange={e => setReviewNotes(prev => ({ ...prev, [sub.id]: e.target.value }))}
              className="flex-1 text-sm"
            />
            <Button size="sm" onClick={() => handleAction(sub.id, 'approved')} className="gap-1">
              <Check className="w-3 h-3" /> Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleAction(sub.id, 'denied')} className="gap-1">
              <X className="w-3 h-3" /> Deny
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
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="text-muted-foreground">No submissions found.</p>
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
                    <span className="font-medium text-foreground">Bulk upload</span>
                    <span className="text-muted-foreground">
                      {group.items.length} course{group.items.length !== 1 ? 's' : ''} across {tracks.length} track{tracks.length !== 1 ? 's' : ''}
                      {' • '}{new Date(group.items[0].created_at).toLocaleString()}
                    </span>
                  </div>
                  {pendingCount > 0 && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => handleBatchAction(group.items, 'approved')} className="gap-1">
                        <Check className="w-3 h-3" /> Approve all ({pendingCount})
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleBatchAction(group.items, 'denied')} className="gap-1">
                        <X className="w-3 h-3" /> Deny all
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
