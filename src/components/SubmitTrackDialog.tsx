import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Send } from 'lucide-react';

interface SubmitTrackDialogProps {
  trigger: React.ReactNode;
}

export function SubmitTrackDialog({ trigger }: SubmitTrackDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('new_track');
  const [trackName, setTrackName] = useState('');
  const [trackShortName, setTrackShortName] = useState('');
  const [courseName, setCourseName] = useState('');
  const [startALat, setStartALat] = useState('');
  const [startALng, setStartALng] = useState('');
  const [startBLat, setStartBLat] = useState('');
  const [startBLng, setStartBLng] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!trackName.trim() || !courseName.trim()) {
      toast({ title: 'Track name and course name are required', variant: 'destructive' });
      return;
    }
    if (type === 'new_track' && !trackShortName.trim()) {
      toast({ title: 'Short name is required for new tracks', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke('submit-track', {
        body: {
          type,
          track_name: trackName.trim(),
          track_short_name: type === 'new_track' ? trackShortName.trim() : undefined,
          course_name: courseName.trim(),
          course_data: {
            start_a_lat: parseFloat(startALat),
            start_a_lng: parseFloat(startALng),
            start_b_lat: parseFloat(startBLat),
            start_b_lng: parseFloat(startBLng),
          },
        },
      });
      if (error) throw error;
      toast({ title: 'Submission sent!', description: 'An admin will review your submission.' });
      setOpen(false);
      resetForm();
    } catch (e: unknown) {
      toast({ title: 'Submission failed', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const resetForm = () => {
    setType('new_track');
    setTrackName('');
    setTrackShortName('');
    setCourseName('');
    setStartALat('');
    setStartALng('');
    setStartBLat('');
    setStartBLng('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit Track / Course</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Submission Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new_track">New Track</SelectItem>
                <SelectItem value="new_course">New Course</SelectItem>
                <SelectItem value="course_modification">Course Modification</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Track Name</Label>
            <Input value={trackName} onChange={e => setTrackName(e.target.value)} placeholder="Orlando Kart Center" />
          </div>
          {type === 'new_track' && (
            <div>
              <Label>Short Name (max 8 chars)</Label>
              <Input value={trackShortName} onChange={e => setTrackShortName(e.target.value.slice(0, 8))} placeholder="OKC" maxLength={8} />
            </div>
          )}
          <div>
            <Label>Course Name</Label>
            <Input value={courseName} onChange={e => setCourseName(e.target.value)} placeholder="Normal" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start A Lat</Label>
              <Input type="number" step="any" value={startALat} onChange={e => setStartALat(e.target.value)} />
            </div>
            <div>
              <Label>Start A Lng</Label>
              <Input type="number" step="any" value={startALng} onChange={e => setStartALng(e.target.value)} />
            </div>
            <div>
              <Label>Start B Lat</Label>
              <Input type="number" step="any" value={startBLat} onChange={e => setStartBLat(e.target.value)} />
            </div>
            <div>
              <Label>Start B Lng</Label>
              <Input type="number" step="any" value={startBLng} onChange={e => setStartBLng(e.target.value)} />
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            <Send className="w-4 h-4 mr-2" /> {loading ? 'Submitting...' : 'Submit for Review'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
