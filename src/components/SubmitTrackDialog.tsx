import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Send } from 'lucide-react';
import type { Course } from '@/types/racing';

interface SubmitTrackDialogProps {
  trigger: React.ReactNode;
  /** Pre-fill values when opening from manage mode */
  prefill?: {
    type: 'new_track' | 'new_course' | 'course_modification';
    trackName: string;
    trackShortName?: string;
    courseName: string;
    course?: Course;
  };
}

export function SubmitTrackDialog({ trigger, prefill }: SubmitTrackDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('new_track');
  const [trackName, setTrackName] = useState('');
  const [trackShortName, setTrackShortName] = useState('');
  const [courseName, setCourseName] = useState('');
  const [startALat, setStartALat] = useState('');
  const [startALng, setStartALng] = useState('');
  const [startBLat, setStartBLat] = useState('');
  const [startBLng, setStartBLng] = useState('');
  const [s2aLat, setS2aLat] = useState('');
  const [s2aLng, setS2aLng] = useState('');
  const [s2bLat, setS2bLat] = useState('');
  const [s2bLng, setS2bLng] = useState('');
  const [s3aLat, setS3aLat] = useState('');
  const [s3aLng, setS3aLng] = useState('');
  const [s3bLat, setS3bLat] = useState('');
  const [s3bLng, setS3bLng] = useState('');
  const [loading, setLoading] = useState(false);

  // Pre-fill form when dialog opens with prefill data
  useEffect(() => {
    if (open && prefill) {
      setType(prefill.type);
      setTrackName(prefill.trackName);
      setTrackShortName(prefill.trackShortName || '');
      setCourseName(prefill.courseName);
      if (prefill.course) {
        setStartALat(String(prefill.course.startFinishA.lat));
        setStartALng(String(prefill.course.startFinishA.lon));
        setStartBLat(String(prefill.course.startFinishB.lat));
        setStartBLng(String(prefill.course.startFinishB.lon));
        if (prefill.course.sector2) {
          setS2aLat(String(prefill.course.sector2.a.lat));
          setS2aLng(String(prefill.course.sector2.a.lon));
          setS2bLat(String(prefill.course.sector2.b.lat));
          setS2bLng(String(prefill.course.sector2.b.lon));
        }
        if (prefill.course.sector3) {
          setS3aLat(String(prefill.course.sector3.a.lat));
          setS3aLng(String(prefill.course.sector3.a.lon));
          setS3bLat(String(prefill.course.sector3.b.lat));
          setS3bLng(String(prefill.course.sector3.b.lon));
        }
      }
    }
  }, [open, prefill]);

  const parseOpt = (v: string) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };

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
      const courseData: Record<string, number | undefined> = {
        start_a_lat: parseFloat(startALat),
        start_a_lng: parseFloat(startALng),
        start_b_lat: parseFloat(startBLat),
        start_b_lng: parseFloat(startBLng),
        sector_2_a_lat: parseOpt(s2aLat),
        sector_2_a_lng: parseOpt(s2aLng),
        sector_2_b_lat: parseOpt(s2bLat),
        sector_2_b_lng: parseOpt(s2bLng),
        sector_3_a_lat: parseOpt(s3aLat),
        sector_3_a_lng: parseOpt(s3aLng),
        sector_3_b_lat: parseOpt(s3bLat),
        sector_3_b_lng: parseOpt(s3bLng),
      };
      // Remove undefined values
      for (const key of Object.keys(courseData)) {
        if (courseData[key] === undefined) delete courseData[key];
      }

      const { error } = await supabase.functions.invoke('submit-track', {
        body: {
          type,
          track_name: trackName.trim(),
          track_short_name: type === 'new_track' ? trackShortName.trim() : undefined,
          course_name: courseName.trim(),
          course_data: courseData,
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
    setTrackName(''); setTrackShortName(''); setCourseName('');
    setStartALat(''); setStartALng(''); setStartBLat(''); setStartBLng('');
    setS2aLat(''); setS2aLng(''); setS2bLat(''); setS2bLng('');
    setS3aLat(''); setS3aLng(''); setS3bLat(''); setS3bLng('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
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

          {/* Start/Finish */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-green-400">Start/Finish Line</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">A Lat</Label><Input type="number" step="any" value={startALat} onChange={e => setStartALat(e.target.value)} /></div>
              <div><Label className="text-xs">A Lng</Label><Input type="number" step="any" value={startALng} onChange={e => setStartALng(e.target.value)} /></div>
              <div><Label className="text-xs">B Lat</Label><Input type="number" step="any" value={startBLat} onChange={e => setStartBLat(e.target.value)} /></div>
              <div><Label className="text-xs">B Lng</Label><Input type="number" step="any" value={startBLng} onChange={e => setStartBLng(e.target.value)} /></div>
            </div>
          </div>

          {/* Sector 2 */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-purple-400">Sector 2 Line (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">A Lat</Label><Input type="number" step="any" value={s2aLat} onChange={e => setS2aLat(e.target.value)} /></div>
              <div><Label className="text-xs">A Lng</Label><Input type="number" step="any" value={s2aLng} onChange={e => setS2aLng(e.target.value)} /></div>
              <div><Label className="text-xs">B Lat</Label><Input type="number" step="any" value={s2bLat} onChange={e => setS2bLat(e.target.value)} /></div>
              <div><Label className="text-xs">B Lng</Label><Input type="number" step="any" value={s2bLng} onChange={e => setS2bLng(e.target.value)} /></div>
            </div>
          </div>

          {/* Sector 3 */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-purple-400">Sector 3 Line (optional)</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">A Lat</Label><Input type="number" step="any" value={s3aLat} onChange={e => setS3aLat(e.target.value)} /></div>
              <div><Label className="text-xs">A Lng</Label><Input type="number" step="any" value={s3aLng} onChange={e => setS3aLng(e.target.value)} /></div>
              <div><Label className="text-xs">B Lat</Label><Input type="number" step="any" value={s3bLat} onChange={e => setS3bLat(e.target.value)} /></div>
              <div><Label className="text-xs">B Lng</Label><Input type="number" step="any" value={s3bLng} onChange={e => setS3bLng(e.target.value)} /></div>
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
