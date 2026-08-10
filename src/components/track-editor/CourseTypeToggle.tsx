import { useTranslation } from 'react-i18next';
import { Flag, MoveRight } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { CourseType } from '@/types/racing';

interface CourseTypeToggleProps {
  value: CourseType;
  onChange: (type: CourseType) => void;
  /**
   * Locks the control. Changing the type of a course that already has geometry
   * would silently invalidate it (a circuit's three majors are not a sprint's
   * splits, and vice versa), so callers editing an existing course pass this.
   */
  disabled?: boolean;
}

/**
 * Circuit vs sprint picker for the course editor.
 *
 * This is the primary signal for the whole sprint feature — the `race_mode`
 * device setting is only the tiebreak when both kinds of track are in range of
 * the logger at once. See `docs/plans/0015-sprint-mode.md`.
 */
export function CourseTypeToggle({ value, onChange, disabled = false }: CourseTypeToggleProps) {
  const { t } = useTranslation('tracks');

  const option = (type: CourseType, Icon: typeof Flag, label: string, hint: string) => {
    const selected = value === type;
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={() => onChange(type)}
        className={cn(
          'flex-1 rounded-md border px-3 py-2 text-left transition-colors',
          selected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent/40',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </button>
    );
  };

  return (
    <div className="space-y-1.5">
      <Label>{t('addCourse.courseType')}</Label>
      <div className="flex gap-2">
        {option('circuit', Flag, t('addCourse.typeCircuit'), t('addCourse.typeCircuitHint'))}
        {option('sprint', MoveRight, t('addCourse.typeSprint'), t('addCourse.typeSprintHint'))}
      </div>
    </div>
  );
}
