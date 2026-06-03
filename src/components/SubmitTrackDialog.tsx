import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Send, ShieldCheck, ArrowRight, ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Check } from 'lucide-react';
import { loadTracks, loadDefaultTracks } from '@/lib/trackStorage';
import { buildSubmissionPlan, type SubmissionPlan, type SubmissionCourse } from '@/lib/trackSubmission';
import { loadSubmittedRecords, markCoursesSubmitted } from '@/lib/submittedTracksStorage';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

interface SubmitTrackDialogProps {
  trigger: React.ReactNode;
  /** Notified after a successful upload (e.g. to refresh a count badge). */
  onSubmitted?: () => void;
}

type Step = 'confirm' | 'review';

/** A new track can only go up if it has the short name the DB requires. */
function isBlocked(course: SubmissionCourse): boolean {
  return course.type === 'new_track' && !course.trackShortName?.trim();
}

const CHANGE_LABEL: Record<SubmissionCourse['change'], string> = {
  'new-track': 'New track',
  'new-course': 'New course',
  modified: 'Modified',
};

const CHANGE_STYLE: Record<SubmissionCourse['change'], string> = {
  'new-track': 'bg-primary/20 text-primary',
  'new-course': 'bg-primary/20 text-primary',
  modified: 'bg-amber-500/20 text-amber-400',
};

export function SubmitTrackDialog({ trigger, onSubmitted }: SubmitTrackDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('confirm');
  const [plan, setPlan] = useState<SubmissionPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Build the upload plan from everything the user currently has locally.
  const buildPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const [merged, defaults] = await Promise.all([loadTracks(), loadDefaultTracks()]);
      const p = buildSubmissionPlan(merged, defaults, loadSubmittedRecords());
      setPlan(p);
      // Default-select everything still pending and submittable.
      const next = new Set<string>();
      for (const g of p.groups) {
        for (const c of g.courses) {
          if (!c.alreadySubmitted && !isBlocked(c)) next.add(c.key);
        }
      }
      setSelected(next);
    } catch (e) {
      toast({ title: 'Could not read your tracks', description: (e as Error).message, variant: 'destructive' });
    }
    setPlanLoading(false);
  }, []);

  // Load Turnstile script once.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (document.getElementById('cf-turnstile-script')) return;
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const renderTurnstile = useCallback(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return;
    const win = window as unknown as { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void } };
    if (!win.turnstile) return;
    if (widgetIdRef.current) {
      try { win.turnstile.remove(widgetIdRef.current); } catch { /* already removed */ }
      widgetIdRef.current = null;
    }
    setTurnstileToken(null);
    widgetIdRef.current = win.turnstile.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      theme: 'dark',
    });
  }, []);

  useEffect(() => {
    if (step === 'review' && open) {
      const timer = setTimeout(renderTurnstile, 200);
      return () => clearTimeout(timer);
    }
  }, [step, open, renderTurnstile]);

  // Reset + (re)build the plan each time the dialog opens.
  useEffect(() => {
    if (open) {
      setStep('confirm');
      setTurnstileToken(null);
      buildPlan();
    }
  }, [open, buildPlan]);

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectedCourses: SubmissionCourse[] =
    plan?.groups.flatMap(g => g.courses).filter(c => selected.has(c.key)) ?? [];

  const handleSubmit = async () => {
    if (selectedCourses.length === 0) {
      toast({ title: 'Nothing selected to submit', variant: 'destructive' });
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      toast({ title: 'Please complete the verification', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const submissions = selectedCourses.map(c => ({
        type: c.type,
        track_name: c.trackName,
        track_short_name: c.type === 'new_track' ? c.trackShortName : undefined,
        course_name: c.courseName,
        course_data: c.courseData,
        layout_data: c.layout,
      }));

      const { data, error } = await supabase.functions.invoke('submit-track', {
        body: { submissions, turnstile_token: turnstileToken },
      });
      if (error) throw error;

      const batchId = (data as { batch_id?: string } | null)?.batch_id ?? `local-${Date.now()}`;
      markCoursesSubmitted(selectedCourses, batchId);

      toast({
        title: 'Submission sent!',
        description: `${selectedCourses.length} course${selectedCourses.length !== 1 ? 's' : ''} sent for review. Thank you for contributing!`,
      });
      onSubmitted?.();
      setOpen(false);
    } catch (e: unknown) {
      toast({ title: 'Submission failed', description: (e as Error).message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const pendingCount = plan?.pendingCount ?? 0;
  const hasAnything = (plan?.groups.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        {step === 'confirm' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                Share your tracks with the community
              </DialogTitle>
              <DialogDescription>
                Contribute the tracks and courses you've created to the shared database.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm text-muted-foreground">
                <p className="text-foreground font-medium">What happens when you submit:</p>
                <ul className="list-disc list-inside space-y-1.5">
                  <li>We figure out which of your tracks/courses aren't in the community database yet and send only those.</li>
                  <li>An admin reviews each one and approves or rejects it.</li>
                  <li>If approved, your track data becomes available to <strong className="text-foreground">all users</strong> in future updates.</li>
                  <li>Your IP address is logged for anti-spam purposes — nothing else personal is stored.</li>
                </ul>
              </div>
              <Button onClick={() => setStep('review')} className="w-full" disabled={planLoading}>
                {planLoading
                  ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking your tracks…</>)
                  : (<><ArrowRight className="w-4 h-4 mr-2" /> Review what you'll send{pendingCount > 0 ? ` (${pendingCount})` : ''}</>)}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review your contribution</DialogTitle>
              <DialogDescription>
                These are the tracks and courses that will be sent to the community database.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {!hasAnything ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  Everything you've created is already in the community database. Nothing new to send.
                </div>
              ) : (
                <div className="space-y-3">
                  {plan!.groups.map(group => (
                    <div key={group.trackName} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{group.trackName}</span>
                        {group.shortName && <span className="text-xs text-muted-foreground">({group.shortName})</span>}
                        <span className={`text-xs px-2 py-0.5 rounded ${group.trackStatus === 'new' ? 'bg-primary/20 text-primary' : 'bg-amber-500/20 text-amber-400'}`}>
                          {group.trackStatus === 'new' ? 'New' : 'Edited'}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {group.courses.map(course => {
                          const blocked = isBlocked(course);
                          const checked = selected.has(course.key);
                          return (
                            <button
                              key={course.key}
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              disabled={blocked}
                              onClick={() => toggle(course.key)}
                              className={`w-full flex items-center gap-2 text-sm text-left ${blocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
                                {checked && <Check className="w-3 h-3" />}
                              </span>
                              <span className="flex-1 flex items-center gap-2 flex-wrap">
                                <span className="text-foreground">{course.courseName}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${CHANGE_STYLE[course.change]}`}>
                                  {CHANGE_LABEL[course.change]}
                                </span>
                                {course.layout && course.layout.length >= 2 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                                    + drawing
                                  </span>
                                )}
                                {course.alreadySubmitted && (
                                  <span className="text-xs text-muted-foreground">already submitted</span>
                                )}
                                {blocked && (
                                  <span className="flex items-center gap-1 text-xs text-amber-400">
                                    <AlertTriangle className="w-3 h-3" /> needs a short name
                                  </span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {TURNSTILE_SITE_KEY && hasAnything && (
                <div className="flex justify-center">
                  <div ref={turnstileRef} />
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('confirm')} className="flex-shrink-0">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={loading || selectedCourses.length === 0 || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
                  className="flex-1"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {loading
                    ? 'Submitting…'
                    : `Submit ${selectedCourses.length} course${selectedCourses.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
