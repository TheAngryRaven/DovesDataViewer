import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { getDatabase } from '@/lib/db';
import type { DbTrack } from '@/lib/db/types';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';

export function TracksTab() {
  const [tracks, setTracks] = useState<DbTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const db = getDatabase();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTracks(await db.getTracks());
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newName.trim() || !newShortName.trim()) return;
    if (newShortName.trim().length > 8) {
      toast({ title: 'Short name must be 8 characters or less', variant: 'destructive' });
      return;
    }
    try {
      await db.createTrack({ name: newName.trim(), short_name: newShortName.trim() });
      setNewName(''); setNewShortName(''); setShowAdd(false);
      toast({ title: 'Track created' });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim() || !editShortName.trim()) return;
    try {
      await db.updateTrack(id, { name: editName.trim(), short_name: editShortName.trim() });
      setEditingId(null);
      toast({ title: 'Track updated' });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await db.updateTrack(id, { enabled });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await db.deleteTrack(id);
      toast({ title: 'Track deleted' });
      load();
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-foreground">Tracks</h3>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4 mr-1" /> Add Track</Button>
      </div>

      {showAdd && (
        <div className="racing-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Track Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Orlando Kart Center" />
            </div>
            <div>
              <Label>Short Name (max 8)</Label>
              <Input value={newShortName} onChange={e => setNewShortName(e.target.value.slice(0, 8))} placeholder="OKC" maxLength={8} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}><Check className="w-4 h-4 mr-1" /> Create</Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}><X className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : tracks.length === 0 ? (
        <p className="text-muted-foreground">No tracks in database.</p>
      ) : (
        <div className="space-y-2">
          {tracks.map(track => (
            <div key={track.id} className="racing-card p-3 flex items-center justify-between">
              {editingId === track.id ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input value={editName} onChange={e => setEditName(e.target.value)} className="flex-1" />
                  <Input value={editShortName} onChange={e => setEditShortName(e.target.value.slice(0, 8))} className="w-24" maxLength={8} />
                  <Button size="icon" className="h-8 w-8" onClick={() => handleUpdate(track.id)}><Check className="w-4 h-4" /></Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Switch checked={track.enabled} onCheckedChange={val => handleToggle(track.id, val)} />
                    <span className="font-medium text-foreground">{track.name}</span>
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{track.short_name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingId(track.id); setEditName(track.name); setEditShortName(track.short_name); }}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(track.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
