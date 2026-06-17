import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Send, ShieldCheck, ArrowRight, ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Check, Gift } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { loadTracks, loadDefaultTracks } from '@/lib/trackStorage';
import { buildSubmissionPlan, type SubmissionPlan, type SubmissionCourse } from '@/lib/trackSubmission';
import { loadSubmittedRecords, markCoursesSubmitted } from '@/lib/submittedTracksStorage';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
// The free-cloud-storage incentive only makes sense when accounts exist.
const CLOUD_ENABLED = import.meta.env.VITE_ENABLE_CLOUD === 'true';

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

const changeLabel = (change: SubmissionCourse['change'], t: TFunction<'tracks'>): string => {
  switch (change) {
    case 'new-track': return t('submit.changeNewTrack');
    case 'new-course': return t('submit.changeNewCourse');
    default: return t('submit.changeModified');
  }
};

const CHANGE_STYLE: Record<SubmissionCourse['change'], string> = {
  'new-track': 'bg-primary/20 text-primary',
  'new-course': 'bg-primary/20 text-primary',
  modified: 'bg-amber-500/20 text-amber-400',
};

export function SubmitTrackDialog({ trigger, onSubmitted }: SubmitTrackDialogProps) {
  const { t } = useTranslation('tracks');
  const { user } = useAuth();
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
      toast({ title: t('submit.toastCouldNotRead'), description: (e as Error).message, variant: 'destructive' });
    }
    setPlanLoading(false);
  }, [t]);

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
      toast({ title: t('submit.toastNothingSelected'), variant: 'destructive' });
      return;
    }
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      toast({ title: t('submit.toastVerify'), variant: 'destructive' });
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

      // Dynamic import: submitting is online-only and rare, so the Supabase
      // client stays out of the initial bundle (this dialog rides the eager
      // TrackEditor on the landing page).
      const { supabase } = await import('@/integrations/supabase/client');
      const { data, error } = await supabase.functions.invoke('submit-track', {
        body: { submissions, turnstile_token: turnstileToken },
      });
      if (error) throw error;

      const batchId = (data as { batch_id?: string } | null)?.batch_id ?? `local-${Date.now()}`;
      markCoursesSubmitted(selectedCourses, batchId);

      toast({
        title: t('submit.toastSent'),
        description: t('submit.toastSentDesc', { count: selectedCourses.length }),
      });
      onSubmitted?.();
      setOpen(false);
    } catch (e: unknown) {
      toast({ title: t('submit.toastFailed'), description: (e as Error).message, variant: 'destructive' });
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
                {t('submit.confirmTitle')}
              </DialogTitle>
              <DialogDescription>
                {t('submit.confirmDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm text-muted-foreground">
                <p className="text-foreground font-medium">{t('submit.whatHappens')}</p>
                <ul className="list-disc list-inside space-y-1.5">
                  <li>{t('submit.li1')}</li>
                  <li>{t('submit.li2')}</li>
                  <li><Trans ns="tracks" i18nKey="submit.li3" components={{ b: <strong className="text-foreground" /> }} /></li>
                  <li>{t('submit.li4')}</li>
                </ul>
              </div>
              <Button onClick={() => setStep('review')} className="w-full" disabled={planLoading}>
                {planLoading
                  ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('submit.checking')}</>)
                  : (<><ArrowRight className="w-4 h-4 mr-2" /> {t('submit.reviewBtn')}{pendingCount > 0 ? ` (${pendingCount})` : ''}</>)}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('submit.reviewTitle')}</DialogTitle>
              <DialogDescription>
                {t('submit.reviewDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {!hasAnything ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  {t('submit.nothingNew')}
                </div>
              ) : (
                <div className="space-y-3">
                  {plan!.groups.map(group => (
                    <div key={group.trackName} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{group.trackName}</span>
                        {group.shortName && <span className="text-xs text-muted-foreground">({group.shortName})</span>}
                        <span className={`text-xs px-2 py-0.5 rounded ${group.trackStatus === 'new' ? 'bg-primary/20 text-primary' : 'bg-amber-500/20 text-amber-400'}`}>
                          {group.trackStatus === 'new' ? t('submit.statusNew') : t('submit.statusEdited')}
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
                                  {changeLabel(course.change, t)}
                                </span>
                                {course.layout && course.layout.length >= 2 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400">
                                    {t('submit.drawingBadge')}
                                  </span>
                                )}
                                {course.alreadySubmitted && (
                                  <span className="text-xs text-muted-foreground">{t('submit.alreadySubmitted')}</span>
                                )}
                                {blocked && (
                                  <span className="flex items-center gap-1 text-xs text-amber-400">
                                    <AlertTriangle className="w-3 h-3" /> {t('submit.needsShortName')}
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

              {CLOUD_ENABLED && hasAnything && (
                <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <Gift className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">
                    {user ? t('submit.accountNoticeSignedIn') : t('submit.accountNotice')}
                  </span>
                </div>
              )}

              {TURNSTILE_SITE_KEY && hasAnything && (
                <div className="flex justify-center">
                  <div ref={turnstileRef} />
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('confirm')} className="flex-shrink-0">
                  <ArrowLeft className="w-4 h-4 mr-1" /> {t('submit.back')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={loading || selectedCourses.length === 0 || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
                  className="flex-1"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {loading
                    ? t('submit.submitting')
                    : t('submit.submitBtn', { count: selectedCourses.length })}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
