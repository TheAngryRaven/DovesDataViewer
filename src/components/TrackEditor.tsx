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

  const TrackForm = ({ isEdit = false }: { isEdit?: boolean }) => (
    <div className="space-y-4">
      <div>
        <Label htmlFor="trackName">Track Name</Label>
        <Input
          id="trackName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="e.g., Laguna Seca"
          className="font-mono"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          Start/Finish Line Point A
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="latA" className="text-xs">Latitude</Label>
            <Input
              id="latA"
              value={latA}
              onChange={(e) => setLatA(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="36.5849"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="lonA" className="text-xs">Longitude</Label>
            <Input
              id="lonA"
              value={lonA}
              onChange={(e) => setLonA(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="-121.7527"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          Start/Finish Line Point B
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="latB" className="text-xs">Latitude</Label>
            <Input
              id="latB"
              value={latB}
              onChange={(e) => setLatB(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="36.5851"
              className="font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="lonB" className="text-xs">Longitude</Label>
            <Input
              id="lonB"
              value={lonB}
              onChange={(e) => setLonB(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="-121.7525"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={isEdit ? handleUpdate : handleCreate} className="flex-1">
          <Check className="w-4 h-4 mr-2" />
          {isEdit ? 'Update' : 'Create'}
        </Button>
        <Button 
          variant="outline" 
          onClick={() => {
            resetForm();
            isEdit ? setIsEditing(false) : setIsCreating(false);
          }}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="w-4 h-4 text-racing-startFinish" />
        <span className="text-sm font-medium">Track</span>
      </div>

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
            <TrackForm />
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
                <TrackForm isEdit />
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

      {selectedTrack && (
        <div className="text-xs text-muted-foreground font-mono space-y-1 p-2 bg-muted/30 rounded">
          <p>A: {selectedTrack.startFinishA.lat.toFixed(6)}, {selectedTrack.startFinishA.lon.toFixed(6)}</p>
          <p>B: {selectedTrack.startFinishB.lat.toFixed(6)}, {selectedTrack.startFinishB.lon.toFixed(6)}</p>
        </div>
      )}
    </div>
  );
}
