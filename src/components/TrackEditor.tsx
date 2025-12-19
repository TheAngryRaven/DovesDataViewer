import { useState, useEffect } from 'react';
import { MapPin, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Track } from '@/types/racing';
import { loadTracks, saveTracks, generateTrackId, deleteTrack } from '@/lib/trackStorage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface TrackEditorProps {
  selectedTrack: Track | null;
  onTrackSelect: (track: Track | null) => void;
}

type TrackFormMode = 'create' | 'edit';

interface TrackFormProps {
  mode: TrackFormMode;
  name: string;
  latA: string;
  lonA: string;
  latB: string;
  lonB: string;
  onNameChange: (value: string) => void;
  onLatAChange: (value: string) => void;
  onLonAChange: (value: string) => void;
  onLatBChange: (value: string) => void;
  onLonBChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function TrackForm({
  mode,
  name,
  latA,
  lonA,
  latB,
  lonB,
  onNameChange,
  onLatAChange,
  onLonAChange,
  onLatBChange,
  onLonBChange,
  onSubmit,
  onCancel,
}: TrackFormProps) {
  const stopKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent Radix Select typeahead / focus management from stealing focus.
    e.stopPropagation();
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="trackName">Track Name</Label>
        <Input
          id="trackName"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDownCapture={stopKeys}
          placeholder="e.g., Laguna Seca"
          className="font-mono"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line Point A</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="latA" className="text-xs">Latitude</Label>
            <Input
              id="latA"
              value={latA}
              onChange={(e) => onLatAChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="36.5849"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="lonA" className="text-xs">Longitude</Label>
            <Input
              id="lonA"
              value={lonA}
              onChange={(e) => onLonAChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="-121.7527"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Start/Finish Line Point B</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="latB" className="text-xs">Latitude</Label>
            <Input
              id="latB"
              value={latB}
              onChange={(e) => onLatBChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="36.5851"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="lonB" className="text-xs">Longitude</Label>
            <Input
              id="lonB"
              value={lonB}
              onChange={(e) => onLonBChange(e.target.value)}
              onKeyDownCapture={stopKeys}
              placeholder="-121.7525"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={onSubmit} className="flex-1">
          <Check className="w-4 h-4 mr-2" />
          {mode === 'edit' ? 'Update' : 'Create'}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}


export function TrackEditor({ selectedTrack, onTrackSelect }: TrackEditorProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [latA, setLatA] = useState('');
  const [lonA, setLonA] = useState('');
  const [latB, setLatB] = useState('');
  const [lonB, setLonB] = useState('');

  useEffect(() => {
    setTracks(loadTracks());
  }, []);

  const resetForm = () => {
    setName('');
    setLatA('');
    setLonA('');
    setLatB('');
    setLonB('');
  };

  const openEditDialog = (track: Track) => {
    setName(track.name);
    setLatA(track.startFinishA.lat.toString());
    setLonA(track.startFinishA.lon.toString());
    setLatB(track.startFinishB.lat.toString());
    setLonB(track.startFinishB.lon.toString());
    setIsEditing(true);
  };

  const handleCreate = () => {
    const latANum = parseFloat(latA);
    const lonANum = parseFloat(lonA);
    const latBNum = parseFloat(latB);
    const lonBNum = parseFloat(lonB);

    if (!name.trim()) return;
    if (isNaN(latANum) || isNaN(lonANum) || isNaN(latBNum) || isNaN(lonBNum)) return;

    const newTrack: Track = {
      id: generateTrackId(),
      name: name.trim(),
      startFinishA: { lat: latANum, lon: lonANum },
      startFinishB: { lat: latBNum, lon: lonBNum },
      createdAt: Date.now()
    };

    const updatedTracks = [...tracks, newTrack];
    saveTracks(updatedTracks);
    setTracks(updatedTracks);
    onTrackSelect(newTrack);
    resetForm();
    setIsCreating(false);
  };

  const handleUpdate = () => {
    if (!selectedTrack) return;

    const latANum = parseFloat(latA);
    const lonANum = parseFloat(lonA);
    const latBNum = parseFloat(latB);
    const lonBNum = parseFloat(lonB);

    if (!name.trim()) return;
    if (isNaN(latANum) || isNaN(lonANum) || isNaN(latBNum) || isNaN(lonBNum)) return;

    const updatedTracks = tracks.map(t => 
      t.id === selectedTrack.id 
        ? {
            ...t,
            name: name.trim(),
            startFinishA: { lat: latANum, lon: lonANum },
            startFinishB: { lat: latBNum, lon: lonBNum }
          }
        : t
    );

    saveTracks(updatedTracks);
    setTracks(updatedTracks);
    const updated = updatedTracks.find(t => t.id === selectedTrack.id);
    if (updated) onTrackSelect(updated);
    resetForm();
    setIsEditing(false);
  };

  const handleDelete = (trackId: string) => {
    const updatedTracks = deleteTrack(trackId);
    setTracks(updatedTracks);
    if (selectedTrack?.id === trackId) {
      onTrackSelect(null);
    }
  };

  const closeCreateDialog = () => {
    resetForm();
    setIsCreating(false);
  };

  const closeEditDialog = () => {
    resetForm();
    setIsEditing(false);
  };

  return (
    <div className="flex gap-2">
        <Select
          value={selectedTrack?.id || ''}
          onValueChange={(value) => {
            const track = tracks.find(t => t.id === value);
            onTrackSelect(track || null);
          }}
        >
          <SelectTrigger className="flex-1 font-mono text-sm">
            <SelectValue placeholder="Select a track..." />
          </SelectTrigger>
          <SelectContent>
            {tracks.map((track) => (
              <SelectItem key={track.id} value={track.id} className="font-mono">
                {track.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon">
              <Plus className="w-4 h-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Track</DialogTitle>
            </DialogHeader>
            <TrackForm
              mode="create"
              name={name}
              latA={latA}
              lonA={lonA}
              latB={latB}
              lonB={lonB}
              onNameChange={setName}
              onLatAChange={setLatA}
              onLonAChange={setLonA}
              onLatBChange={setLatB}
              onLonBChange={setLonB}
              onSubmit={handleCreate}
              onCancel={closeCreateDialog}
            />
          </DialogContent>
        </Dialog>

        {selectedTrack && (
          <>
            <Dialog open={isEditing} onOpenChange={setIsEditing}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => openEditDialog(selectedTrack)}
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Track</DialogTitle>
                </DialogHeader>
                <TrackForm
                  mode="edit"
                  name={name}
                  latA={latA}
                  lonA={lonA}
                  latB={latB}
                  lonB={lonB}
                  onNameChange={setName}
                  onLatAChange={setLatA}
                  onLonAChange={setLonA}
                  onLatBChange={setLatB}
                  onLonBChange={setLonB}
                  onSubmit={handleUpdate}
                  onCancel={closeEditDialog}
                />
              </DialogContent>
            </Dialog>

            <Button
              variant="outline"
              size="icon"
              onClick={() => handleDelete(selectedTrack.id)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        )}
    </div>
  );
}
