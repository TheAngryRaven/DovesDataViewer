import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbSubmission } from '@/lib/db/types';
import { Check, X } from 'lucide-react';

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

  const handleAction = async (id: string, status: 'approved' | 'denied') => {
    try {
      await db.updateSubmission(id, status, reviewNotes[id]);
      toast({ title: `Submission ${status}` });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
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
        <div className="space-y-3">
          {submissions.map(sub => (
            <div key={sub.id} className="racing-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{sub.type}</span>
                  <span className="ml-2 text-sm font-medium text-foreground">{sub.track_name}</span>
                  {sub.track_short_name && <span className="ml-1 text-xs text-muted-foreground">({sub.track_short_name})</span>}
                  <span className="mx-1 text-muted-foreground">→</span>
                  <span className="text-sm text-foreground">{sub.course_name}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${sub.status === 'pending' ? 'bg-accent text-accent-foreground' : sub.status === 'approved' ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'}`}>
                  {sub.status}
                </span>
              </div>
              <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-32">
                {JSON.stringify(sub.course_data, null, 2)}
              </pre>
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
          ))}
        </div>
      )}
    </div>
  );
}
