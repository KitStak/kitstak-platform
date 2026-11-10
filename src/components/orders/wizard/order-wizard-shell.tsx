"use client";

/**
 * Page wizard layout for shipment orders, composed from the shared wizard primitives
 * (`useWizard` + `WizardStepper`) so the right rail can carry more than one card
 * (docs/requests/orders-outbound.md REQ-4). Adds an external "attention" state per step
 * (Step 2 while the ship-to address is unverified).
 */
import * as React from "react";
import { FormProvider, useFormState, type DefaultValues, type FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { UnsavedChangesGuard } from "@/components/ui/unsaved-changes";
import { useWizard, WizardStepper, type StepMeta, type WizardController, type WizardMode, type WizardStep } from "@/components/ui/wizard";
import { stepFocusTarget } from "@/components/ui/wizard/wizard";
import { WizardModeContext } from "@/components/ui/wizard/wizard-success";

export interface OrderWizardShellProps<T extends FieldValues> {
  readonly steps: readonly WizardStep<T>[];
  readonly mode: WizardMode;
  readonly defaultValues: DefaultValues<T>;
  readonly onComplete: (values: T) => Promise<unknown>;
  readonly draftScope: string | false;
  /** Right column; receives live values + the controller (Save = `wizard.submit`). */
  readonly rail: (values: T, wizard: WizardController<T>) => React.ReactNode;
  /** Steps to flag with the warning state (when not active). */
  readonly attention?: (values: T) => readonly string[];
  readonly success?: React.ReactNode;
  /** Rendered under the wizard card (activity, notes). */
  readonly below?: React.ReactNode;
  readonly onController?: (wizard: WizardController<T>) => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Keep the rail in view while scrolling (create flow; the edit rail is taller). */
  readonly stickyRail?: boolean;
}

function DirtyWatch<T extends FieldValues>({ wizard, onDirtyChange }: { readonly wizard: WizardController<T>; readonly onDirtyChange?: (dirty: boolean) => void }) {
  const { isDirty } = useFormState({ control: wizard.form.control });
  const dirty = isDirty && !wizard.completed && !wizard.submitting;
  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  return <UnsavedChangesGuard when={dirty} />;
}

export function withAttention(metas: readonly StepMeta[], keys: readonly string[]): readonly StepMeta[] {
  if (keys.length === 0) return metas;
  return metas.map((m) => (keys.includes(m.key) && m.status !== "active" && m.status !== "upcoming" ? { ...m, status: "attention" as const } : m));
}

export function OrderWizardShell<T extends FieldValues>({ steps, mode, defaultValues, onComplete, draftScope, rail, attention, success, below, onController, onDirtyChange, stickyRail = true }: OrderWizardShellProps<T>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sectionRef = React.useRef<HTMLElement>(null);
  const wizard = useWizard<T>({ steps, mode, defaultValues, draftScope, onComplete, rootRef });
  const values = wizard.form.watch();
  React.useEffect(() => onController?.(wizard));

  const previous = React.useRef(wizard.nav.current);
  React.useLayoutEffect(() => {
    if (previous.current === wizard.nav.current) return;
    previous.current = wizard.nav.current;
    stepFocusTarget(sectionRef.current)?.focus({ preventScroll: false });
    rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [wizard.nav.current]);

  if (wizard.completed && success) return <WizardModeContext.Provider value={mode}>{success}</WizardModeContext.Provider>;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (wizard.submitting) return;
    if (wizard.isLast) void wizard.submit();
    else void wizard.next();
  };
  const step = wizard.current;
  const metas = withAttention(wizard.metas, attention?.(values) ?? []);

  return (
    <FormProvider {...wizard.form}>
      <div ref={rootRef} className="flex scroll-mt-4 flex-col gap-5">
        <WizardStepper steps={metas} onSelect={wizard.goTo} />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="rounded-lg border border-border bg-surface p-5 shadow-xs">
              <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4">
                {wizard.restoredDraft ? (
                  <Callout variant="info" title="Draft restored" action={<Button size="sm" variant="ghost" onClick={wizard.restart}>Start over</Button>}>
                    We kept the details you entered earlier in this session.
                  </Callout>
                ) : null}
                <section ref={sectionRef} aria-labelledby={`order-step-${step.key}`} className="flex flex-col gap-4">
                  <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h2 id={`order-step-${step.key}`} tabIndex={-1} data-step-heading className="text-[15px] font-semibold text-foreground outline-none">
                      <span className="mr-1.5 text-faint">Step {wizard.nav.current + 1} /</span>
                      {step.label}
                    </h2>
                    {step.description ? <p className="text-[12px] text-secondary">{step.description}</p> : null}
                  </header>
                  {step.render({ form: wizard.form, values, goTo: wizard.goTo })}
                </section>
                <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                  {!wizard.isFirst ? (
                    <Button variant="secondary" onClick={wizard.back} disabled={wizard.submitting}>
                      Back
                    </Button>
                  ) : null}
                  {!wizard.isLast ? (
                    <Button type="submit" variant={mode === "free" ? "secondary" : "primary"} disabled={wizard.submitting}>
                      Next step
                    </Button>
                  ) : null}
                </div>
              </form>
            </div>
            {below}
          </div>
          <div className={stickyRail ? "flex flex-col gap-4 lg:sticky lg:top-4" : "flex flex-col gap-4"}>{rail(values, wizard)}</div>
        </div>
      </div>
      <DirtyWatch wizard={wizard} onDirtyChange={onDirtyChange} />
    </FormProvider>
  );
}
