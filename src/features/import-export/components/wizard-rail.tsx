'use client';
/** Left-rail stepper (WZ-040): completed steps show a check and are clickable; compact header on phones. */
import { Check } from 'lucide-react';
import { cn } from '@/components/ui';
import type { StepId } from '../store';

export interface RailStep {
  readonly id: StepId;
  readonly title: string;
  readonly hint: string;
}

export const RAIL_STEPS: readonly RailStep[] = [
  { id: 'upload', title: 'Upload', hint: 'File or pasted rows' },
  { id: 'destination', title: 'Destination', hint: 'New or existing board' },
  { id: 'map', title: 'Map columns', hint: 'Match file to board' },
  { id: 'review', title: 'Review', hint: 'Duplicates and problems' },
  { id: 'import', title: 'Import', hint: 'Progress and summary' },
];

export interface WizardRailProps {
  readonly current: number;
  /** Highest step index the user may jump to. */
  readonly reachable: number;
  readonly locked: boolean;
  /** The import finished (or was undone): the last step shows a check too. */
  readonly complete?: boolean;
  readonly onSelect: (index: number) => void;
}

export function WizardRail({ current, reachable, locked, complete = false, onSelect }: WizardRailProps) {
  return (
    <>
      <nav aria-label="Import steps" className="hidden w-60 shrink-0 border-r border-border-subtle bg-sunken/60 px-3 py-5 md:block">
        <ol className="flex flex-col gap-0.5">
          {RAIL_STEPS.map((step, index) => {
            const state = index < current || (complete && index === current) ? 'done' : index === current ? 'current' : 'upcoming';
            const clickable = !locked && index !== current && index <= reachable;
            return (
              <li key={step.id} className="relative">
                {index < RAIL_STEPS.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-9 left-[23px] h-[calc(100%-28px)] w-0.5 rounded-full transition-colors duration-[var(--duration-normal)]',
                      index < current ? 'bg-primary' : 'bg-border-subtle',
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  data-testid={`import-step-${step.id}`}
                  aria-current={index === current ? 'step' : undefined}
                  data-state={state}
                  disabled={!clickable && index !== current}
                  onClick={() => clickable && onSelect(index)}
                  className={cn(
                    'group flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-out',
                    'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                    index === current && 'bg-primary-selected',
                    clickable && 'cursor-pointer hover:bg-hover active:bg-pressed',
                    !clickable && index !== current && 'cursor-default',
                  )}
                >
                  <span
                    className={cn(
                      'relative z-[1] mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-[var(--duration-normal)]',
                      state === 'done' && 'bg-primary text-primary-fg',
                      state === 'current' && 'bg-panel text-primary-text ring-2 ring-primary',
                      state === 'upcoming' && 'bg-panel text-fg-muted ring-1 ring-border-default',
                    )}
                  >
                    {state === 'done' ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block truncate text-base',
                        state === 'upcoming' ? 'text-fg-secondary' : 'font-semibold text-fg',
                        index === current && 'text-primary-text',
                      )}
                    >
                      {step.title}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">{step.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 md:hidden">
        <p className="text-sm text-fg-secondary">
          Step {current + 1} of {RAIL_STEPS.length}
        </p>
        <p className="truncate text-sm font-semibold text-fg">{RAIL_STEPS[current]?.title}</p>
        <div className="flex gap-1" aria-hidden>
          {RAIL_STEPS.map((step, index) => (
            <span
              key={step.id}
              className={cn(
                'h-1.5 rounded-full transition-all duration-[var(--duration-normal)]',
                index === current ? 'w-4 bg-primary' : index < current ? 'w-1.5 bg-primary/60' : 'w-1.5 bg-border-default',
              )}
            />
          ))}
        </div>
      </div>
    </>
  );
}
