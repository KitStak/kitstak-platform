'use client';
/**
 * "Vary by day" (docs/programs/SPEC.md 5.4 Step 4, 5.13): a 7 column qty row, Monday first. Blank
 * means the line qty; days the program does not work are dimmed. Used by the schedule editor and
 * the planner.
 */
import { cn } from '@/components/ui';
import { WEEKDAY_SHORT, WEEK_ORDER } from './schedule-model';

export interface VaryByDayRowProps {
  readonly name: string;
  /** The line qty shown as the placeholder of blank days. */
  readonly baseQty: string;
  readonly value: Readonly<Record<string, string>>;
  readonly onChange: (value: Record<string, string>) => void;
  /** JS weekday numbers the program works. */
  readonly workingDays: readonly number[];
  readonly disabled?: boolean;
  readonly className?: string;
}

export function VaryByDayRow({ name, baseQty, value, onChange, workingDays, disabled, className }: VaryByDayRowProps) {
  return (
    <div className={cn('grid grid-cols-7 gap-1.5', className)} role="group" aria-label={`Qty by day for ${name}`} data-testid="vary-by-day">
      {WEEK_ORDER.map((day) => {
        const working = workingDays.includes(day);
        const text = value[String(day)] ?? '';
        const bad = text.trim() !== '' && !/^\d{1,8}(\.\d{1,3})?$/.test(text.replace(/,/g, '').trim());
        return (
          <label key={day} className={cn('flex flex-col items-center gap-1', !working && 'opacity-50')}>
            <span className="text-2xs font-semibold text-fg-muted uppercase">{WEEKDAY_SHORT[day]}</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={`${WEEKDAY_SHORT[day]} qty for ${name}${working ? '' : ' (not a work day)'}`}
              aria-invalid={bad ? true : undefined}
              value={text}
              placeholder={baseQty || '0'}
              disabled={disabled}
              onChange={(event) => {
                const next = { ...value, [String(day)]: event.target.value };
                if (!event.target.value.trim()) delete next[String(day)];
                onChange(next);
              }}
              className={cn(
                'h-7 w-full min-w-0 rounded-md border bg-panel px-1 text-center text-xs tabular-nums text-fg outline-none placeholder:text-fg-muted focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]',
                bad ? 'border-danger' : 'border-border-input hover:border-border-input-hover',
                !working && 'bg-sunken',
              )}
            />
          </label>
        );
      })}
    </div>
  );
}
