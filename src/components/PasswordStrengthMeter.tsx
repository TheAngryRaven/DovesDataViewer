import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  evaluatePassword,
  type PasswordRuleId,
  type PasswordStrengthLevel,
} from '@/lib/passwordStrength';

interface PasswordStrengthMeterProps {
  password: string;
  className?: string;
}

// Bar colour + how many of the four segments fill, per strength level.
const LEVEL_STYLE: Record<PasswordStrengthLevel, { bar: string; segments: number; text: string }> = {
  weak: { bar: 'bg-destructive', segments: 1, text: 'text-destructive' },
  fair: { bar: 'bg-warning', segments: 2, text: 'text-warning' },
  good: { bar: 'bg-warning', segments: 3, text: 'text-warning' },
  strong: { bar: 'bg-success', segments: 4, text: 'text-success' },
};

const RULE_LABEL_KEY = {
  length: 'register.passwordRules.length',
  lowercase: 'register.passwordRules.lowercase',
  uppercase: 'register.passwordRules.uppercase',
  number: 'register.passwordRules.number',
  symbol: 'register.passwordRules.symbol',
} as const satisfies Record<PasswordRuleId, string>;

const STRENGTH_LABEL_KEY = {
  weak: 'register.strengthLevel.weak',
  fair: 'register.strengthLevel.fair',
  good: 'register.strengthLevel.good',
  strong: 'register.strengthLevel.strong',
} as const satisfies Record<PasswordStrengthLevel, string>;

/**
 * Realtime password feedback for sign-up: a four-segment strength bar plus a
 * per-rule checklist. Pure presentation — all logic lives in
 * `lib/passwordStrength` so it stays unit-tested and reusable.
 */
export function PasswordStrengthMeter({ password, className }: PasswordStrengthMeterProps) {
  const { t } = useTranslation('auth');
  const { rules, level } = evaluatePassword(password);
  const style = LEVEL_STYLE[level];
  const hasInput = password.length > 0;

  return (
    <div className={cn('space-y-2', className)} aria-live="polite">
      <div className="flex gap-1" role="presentation">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              hasInput && i < style.segments ? style.bar : 'bg-muted',
            )}
          />
        ))}
      </div>
      {hasInput && (
        <p className={cn('text-xs font-medium', style.text)}>
          {t('register.passwordStrength')}: {t(STRENGTH_LABEL_KEY[level])}
        </p>
      )}
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              'flex items-center gap-1.5 text-xs',
              rule.passed ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {rule.passed ? (
              <Check className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <X className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span>{t(RULE_LABEL_KEY[rule.id])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
