'use client';

/**
 * Wizard (BUILD_PLAN 0.3 / F4.2). One react-hook-form instance spans every step;
 * each step's zod `schema` runs on Next (inline errors + focus first error).
 *
 *   mode="linear"  create flows — a step is clickable once reached; Save on the last step
 *   mode="free"    edit flows   — every step is clickable; Save available on any step
 *   variant="page"   horizontal WizardStepper + optional right WizardRail
 *   variant="drawer" WizardPills header, for use inside <Drawer>
 * Drafts persist in sessionStorage keyed by route (`draftScope` to override / disable).
 */
import * as React from 'react';
import { FormProvider, useFormState, type DefaultValues, type FieldValues } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { Button } from '../button';
import { Callout } from '../callout';
import { Spinner } from '../spinner';
import { DisabledReason } from '../tooltip';
import { UnsavedChangesGuard } from '../unsaved-changes';
import { useWizard, type WizardController } from './use-wizard';
import { WizardPills } from './wizard-pills';
import { WizardRail } from './wizard-rail';
import { WizardStepper } from './wizard-stepper';
import { WizardModeContext } from './wizard-success';
import { proceedReason, type WizardMode, type WizardStep } from './wizard-types';

export interface WizardProps<T extends FieldValues> {
  readonly steps: readonly WizardStep<T>[];
  readonly mode?: WizardMode;
  readonly variant?: 'page' | 'drawer';
  readonly defaultValues: DefaultValues<T>;
  readonly onComplete: (values: T) => unknown | Promise<unknown>;
  readonly onCancel?: () => void;
  readonly submitLabel?: string;
  readonly draftScope?: string | false;
  /** Page variant: right-rail summary content (receives live values). */
  readonly railSummary?: (values: T) => React.ReactNode;
  readonly railTitle?: React.ReactNode;
  /** Page variant: extra cards stacked under the rail card (outside its sticky Save card), e.g. Assigned Jobs / Printouts. */
  readonly railExtra?: (values: T) => React.ReactNode;
  /** Rendered instead of the wizard once `onComplete` resolves. */
  readonly success?: React.ReactNode;
  /** Block navigation away while dirty. Default true. */
  readonly guardUnsaved?: boolean;
  /** Notified when the form becomes dirty / clean (e.g. to confirm a mode switch). */
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly className?: string;
  /** Header navigation: "pills" (drawer default) or "steps" (numbered stepper; page default, also usable in a drawer). */
  readonly stepper?: 'pills' | 'steps';
  /** Page rail status line (e.g. "Started · 6 of 30 received") instead of "Ready to save" / "In progress". */
  readonly railStatusLabel?: React.ReactNode;
  /** Overrides the rail Save disabled reason (e.g. "No changes to save"); omitted = the wizard's own. */
  readonly saveDisabledReason?: string | null;
  /** Fields left out of the session draft (transient flags). */
  readonly transientFields?: readonly string[];
}

function Footer<T extends FieldValues>({
  wizard,
  mode,
  submitLabel,
  onCancel,
  sticky,
  railOwnsSave,
  nextBlocked,
  nextBusy,
}: {
  readonly wizard: WizardController<T>;
  readonly mode: WizardMode;
  readonly submitLabel: string;
  readonly onCancel?: () => void;
  readonly sticky: boolean;
  readonly railOwnsSave: boolean;
  readonly nextBlocked: string | null;
  readonly nextBusy: boolean;
}) {
  // One primary Save: when the right rail shows Save, the footer only navigates.
  const showSave = !railOwnsSave && (mode === 'free' || wizard.isLast);
  const reasonId = React.useId();
  const blocked = nextBusy ? null : nextBlocked;
  return (
    // Sticky in drawers: a solid bar with a top shadow; the Drawer drops its bottom padding (data-sticky-footer) so nothing scrolls visibly under it.
    <div
      data-sticky-footer={sticky ? '' : undefined}
      className={cn(
        'flex items-center justify-between gap-2 border-t border-border pt-3',
        sticky && 'sticky bottom-0 z-10 bg-surface pb-3 shadow-[0_-4px_8px_-6px_rgba(16,24,40,0.15)]',
      )}
    >
      <div>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={wizard.submitting}>
            Cancel
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {!wizard.isFirst ? (
          <Button variant="secondary" onClick={wizard.back} disabled={wizard.submitting}>
            Back
          </Button>
        ) : null}
        {!wizard.isLast && blocked ? (
          // Visible reason next to a blocked Next (also wired to the button for assistive tech).
          <span
            id={reasonId}
            className="hidden max-w-[280px] truncate text-2xs text-secondary sm:inline"
            title={blocked}
          >
            {blocked}
          </span>
        ) : null}
        {!wizard.isLast ? (
          <DisabledReason reason={blocked}>
            <Button
              type="submit"
              variant={showSave ? 'secondary' : 'primary'}
              title={blocked ?? undefined}
              aria-describedby={blocked ? reasonId : undefined}
              aria-busy={nextBusy || undefined}
              disabled={wizard.submitting || nextBusy || Boolean(blocked)}
            >
              {nextBusy ? <Spinner className="h-3.5 w-3.5" label="Loading" /> : null}
              Next
            </Button>
          </DisabledReason>
        ) : null}
        {showSave ? (
          <Button
            type={wizard.isLast ? 'submit' : 'button'}
            variant="primary"
            onClick={wizard.isLast ? undefined : () => void wizard.submit()}
            disabled={wizard.submitting}
            aria-busy={wizard.submitting}
          >
            {wizard.submitting ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
            {submitLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DirtyGuard<T extends FieldValues>({
  wizard,
  guard,
  onDirtyChange,
}: {
  readonly wizard: WizardController<T>;
  readonly guard: boolean;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const { isDirty } = useFormState({ control: wizard.form.control });
  const dirty = isDirty && !wizard.completed;
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  return guard ? <UnsavedChangesGuard when={dirty} /> : null;
}

const FOCUSABLE_FIELD =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button[role="combobox"]:not([disabled]), [role="radio"]:not([disabled]), [role="switch"]:not([disabled])';

/** Where focus goes on a new step: its first field, else its heading (never `<body>`). */
export function stepFocusTarget(section: HTMLElement | null): HTMLElement | null {
  if (!section) return null;
  return (
    section.querySelector<HTMLElement>(FOCUSABLE_FIELD) ??
    section.querySelector<HTMLElement>('[data-step-heading]')
  );
}

/**
 * After a step change, focus moves to the new step's first field (or its heading). Runs in
 * a layout effect so the target is focused before the old Next/Save button unmounts and
 * the browser drops focus to `<body>`.
 */
function useFocusStepOnChange(stepIndex: number, sectionRef: React.RefObject<HTMLElement | null>): void {
  const previous = React.useRef(stepIndex);
  React.useLayoutEffect(() => {
    if (previous.current === stepIndex) return;
    previous.current = stepIndex;
    stepFocusTarget(sectionRef.current)?.focus({ preventScroll: false });
  }, [stepIndex, sectionRef]);
}

export function Wizard<T extends FieldValues>({
  steps,
  mode = 'linear',
  variant = 'page',
  defaultValues,
  onComplete,
  onCancel,
  submitLabel = 'Save',
  draftScope,
  railSummary,
  railTitle,
  railExtra,
  success,
  guardUnsaved = true,
  onDirtyChange,
  className,
  stepper,
  railStatusLabel,
  saveDisabledReason,
  transientFields,
}: WizardProps<T>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sectionRef = React.useRef<HTMLElement>(null);
  const wizard = useWizard<T>({
    steps,
    mode,
    defaultValues,
    draftScope,
    onComplete,
    rootRef,
    transientFields,
  });
  const railSaveReason = saveDisabledReason === undefined ? wizard.saveDisabledReason : saveDisabledReason;
  const stepperKind = stepper ?? (variant === 'page' ? 'steps' : 'pills');
  const values = wizard.form.watch();
  useFocusStepOnChange(wizard.nav.current, sectionRef);
  const railOwnsSave = variant === 'page' && Boolean(railSummary);

  if (wizard.completed && success)
    return <WizardModeContext.Provider value={mode}>{success}</WizardModeContext.Provider>;

  /** Enter in any field runs Next (or Save on the last step), like clicking the button. */
  const onFormSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (wizard.submitting) return;
    if (wizard.isLast) void wizard.submit();
    else if (!proceedReason(wizard.current, values) && !wizard.current.busy?.(values)) void wizard.next();
  };

  const step = wizard.current;
  const nextBlocked = proceedReason(step, values);
  const nextBusy = Boolean(step.busy?.(values));
  const body = (
    <form noValidate onSubmit={onFormSubmit} className="flex min-w-0 flex-col gap-4">
      {wizard.restoredDraft ? (
        <Callout
          variant="info"
          title="Draft restored"
          action={
            <Button size="sm" variant="ghost" onClick={wizard.restart}>
              Start over
            </Button>
          }
        >
          We kept the details you entered earlier in this session.
        </Callout>
      ) : null}
      <section ref={sectionRef} aria-labelledby={`wizard-step-${step.key}`} className="flex flex-col gap-4">
        <header>
          <h2
            id={`wizard-step-${step.key}`}
            tabIndex={-1}
            data-step-heading
            className={cn(
              'text-base font-semibold text-foreground outline-none',
              step.hideHeading && 'sr-only',
            )}
          >
            {step.label}
            {step.isOptional ? <span className="ml-2 text-xs font-normal text-faint">Optional</span> : null}
          </h2>
          {step.description ? <p className="mt-0.5 text-xs text-secondary">{step.description}</p> : null}
        </header>
        {step.render({
          form: wizard.form,
          values,
          goTo: wizard.goTo,
          applyServerErrors: wizard.applyServerErrors,
        })}
      </section>
      <Footer
        wizard={wizard}
        mode={mode}
        submitLabel={submitLabel}
        onCancel={onCancel}
        sticky={variant === 'drawer'}
        railOwnsSave={railOwnsSave}
        nextBlocked={nextBlocked}
        nextBusy={nextBusy}
      />
    </form>
  );

  return (
    <FormProvider {...wizard.form}>
      <div ref={rootRef} className={cn('flex flex-col gap-5', className)}>
        {stepperKind === 'steps' ? (
          <WizardStepper steps={wizard.metas} onSelect={wizard.goTo} />
        ) : (
          <WizardPills steps={wizard.metas} onSelect={wizard.goTo} />
        )}
        {variant === 'page' && railSummary ? (
          // Explicit base track: an implicit auto column would grow to the widest step table and scroll the page at 768px.
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs">{body}</div>
            {railExtra ? (
              <div className="flex min-w-0 flex-col gap-4">
                <WizardRail
                  title={railTitle}
                  percent={wizard.percent}
                  saveLabel={submitLabel}
                  onSave={() => void wizard.submit()}
                  saving={wizard.submitting}
                  saveDisabledReason={railSaveReason}
                  statusLabel={railStatusLabel}
                >
                  {railSummary(values)}
                </WizardRail>
                {railExtra(values)}
              </div>
            ) : (
              <WizardRail
                title={railTitle}
                percent={wizard.percent}
                saveLabel={submitLabel}
                onSave={() => void wizard.submit()}
                saving={wizard.submitting}
                saveDisabledReason={railSaveReason}
                statusLabel={railStatusLabel}
              >
                {railSummary(values)}
              </WizardRail>
            )}
          </div>
        ) : (
          body
        )}
      </div>
      <DirtyGuard wizard={wizard} guard={guardUnsaved} onDirtyChange={onDirtyChange} />
    </FormProvider>
  );
}
