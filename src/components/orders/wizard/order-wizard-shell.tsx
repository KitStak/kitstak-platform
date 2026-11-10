"use client";

/**
 * Page wizard layout for shipment orders, composed from the shared wizard primitives
 * (`useWizard` + `WizardStepper`) so the right rail can carry more than one card
 * (docs/requests/orders-outbound.md REQ-4). Adds an external "attention" state per step
 * (Step 2 while the ship-to address is unverified).
 */
import * as React from "react";
import { FormProvider, useFormState, type DefaultValues, type FieldErrors, type FieldValues } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { UnsavedChangesGuard } from "@/components/ui/unsaved-changes";
import { useWizard, WizardStepper, type StepMeta, type WizardController, type WizardMode, type WizardStep } from "@/components/ui/wizard";
import { stepFocusTarget } from "@/components/ui/wizard/wizard";
import { WizardModeContext } from "@/components/ui/wizard/wizard-success";
import { sessionStorageOrNull, writeDraft } from "@/components/ui/wizard/wizard-state";

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
  /** Content above the wizard (e.g. detail tabs). */
  readonly header?: React.ReactNode;
  /** When set, replaces the stepper + form in the left column; the form stays mounted (hidden) so edits survive tab switches. */
  readonly main?: React.ReactNode;
}

/** True when at least one field carries a user edit (nested objects / arrays included). */
export function hasDirtyFields(dirtyFields: unknown): boolean {
  if (dirtyFields === true) return true;
  if (!dirtyFields || typeof dirtyFields !== "object") return false;
  return Object.values(dirtyFields as Record<string, unknown>).some(hasDirtyFields);
}

/**
 * The guard keys off `dirtyFields`, not `isDirty`: defaults written after mount (auto order code,
 * sole warehouse, default order type) never mark a field dirty, and an edit the user reverts clears.
 */
function DirtyWatch<T extends FieldValues>({ wizard, onDirtyChange }: { readonly wizard: WizardController<T>; readonly onDirtyChange?: (dirty: boolean) => void }) {
  const { dirtyFields } = useFormState({ control: wizard.form.control });
  const dirty = hasDirtyFields(dirtyFields) && !wizard.completed && !wizard.submitting;
  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  return <UnsavedChangesGuard when={dirty} />;
}

/**
 * The shared wizard saves its draft 300 ms after the last keystroke. A reload inside that window
 * (dev HMR full reload, a crash-reload, the user pressing F5) used to lose the last edits, so the
 * draft is also written synchronously when the page is hidden or unloaded.
 */
export function flushDraftNow<T extends FieldValues>(storage: Pick<Storage, "setItem"> | null, scope: string, wizard: Pick<WizardController<T>, "form" | "nav" | "completed">): boolean {
  if (wizard.completed || !hasDirtyFields(wizard.form.formState.dirtyFields)) return false;
  writeDraft(storage, scope, { values: wizard.form.getValues(), nav: wizard.nav });
  return true;
}

function DraftFlush<T extends FieldValues>({ wizard, scope }: { readonly wizard: WizardController<T>; readonly scope: string }) {
  const ref = React.useRef(wizard);
  React.useEffect(() => {
    ref.current = wizard;
  });
  React.useEffect(() => {
    const flush = () => void flushDraftNow(sessionStorageOrNull(), scope, ref.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scope]);
  return null;
}

export interface StepIssueSummary {
  readonly path: string;
  readonly message: string;
}

/** Flattens react-hook-form errors into `{ path, message }` rows (nested + array fields). */
export function summarizeErrors(errors: FieldErrors, prefix = ""): StepIssueSummary[] {
  const out: StepIssueSummary[] = [];
  for (const [key, value] of Object.entries(errors ?? {})) {
    if (!value || typeof value !== "object" || key === "ref") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const msg = (value as { message?: unknown }).message;
    if (typeof msg === "string" && msg) out.push({ path, message: msg });
    else out.push(...summarizeErrors(value as FieldErrors, path));
  }
  return out;
}

function focusField(root: HTMLElement | null, path: string): void {
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(path) : path;
  const target =
    root?.querySelector<HTMLElement>(`[name="${esc}"]:not([disabled])`) ??
    root?.querySelector<HTMLElement>(`[data-field="${esc}"] input:not([disabled]), [data-field="${esc}"] button:not([disabled])`) ??
    root?.querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled]), [data-invalid="true"] input:not([disabled]), [data-invalid="true"] button:not([disabled])');
  target?.focus();
  target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

/**
 * The shared wizard keeps a step flagged "attention" after a failed Next until it is re-checked
 * while current, so a fixed step could stay orange after the user moved on. Here a non-current step
 * whose schema passes on the live values shows as complete once it has been reached; external
 * attention (address verification) is applied after this and still wins.
 */
export function reconcileStepStatus(metas: readonly StepMeta[], valid: readonly boolean[], current: number, reached: number): readonly StepMeta[] {
  return metas.map((m, i) => {
    if (i === current) return m;
    if (valid[i] && i <= reached && (m.status === "attention" || m.status === "upcoming")) return { ...m, status: "complete" as const };
    return m;
  });
}

export function withAttention(metas: readonly StepMeta[], keys: readonly string[]): readonly StepMeta[] {
  if (keys.length === 0) return metas;
  return metas.map((m) => (keys.includes(m.key) && m.status !== "active" && m.status !== "upcoming" ? { ...m, status: "attention" as const } : m));
}

export function OrderWizardShell<T extends FieldValues>({ steps, mode, defaultValues, onComplete, draftScope, rail, attention, success, below, onController, onDirtyChange, stickyRail = true, header, main }: OrderWizardShellProps<T>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const sectionRef = React.useRef<HTMLElement>(null);
  const wizard = useWizard<T>({ steps, mode, defaultValues, draftScope, onComplete, rootRef });
  const values = wizard.form.watch();
  // Subscribe to errors so the "Fix N fields" summary counts every invalid field (not a stale proxy read).
  const { errors } = useFormState({ control: wizard.form.control });
  const [showSummary, setShowSummary] = React.useState(false);
  const { errors: liveErrors } = useFormState({ control: wizard.form.control });
  const advance = async () => {
    const ok = await wizard.next();
    setShowSummary(!ok);
    if (!ok) {
      // After React paints the error state, move focus to the first invalid field.
      window.setTimeout(() => {
        const first = summarizeErrors(wizard.form.formState.errors)[0];
        if (first) focusField(sectionRef.current, first.path);
      }, 50);
    }
  };
  React.useEffect(() => onController?.(wizard));

  const previous = React.useRef(wizard.nav.current);
  React.useLayoutEffect(() => {
    if (previous.current === wizard.nav.current) return;
    previous.current = wizard.nav.current;
    setShowSummary(false);
    stepFocusTarget(sectionRef.current)?.focus({ preventScroll: false });
    rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [wizard.nav.current]);

  if (wizard.completed && success) return <WizardModeContext.Provider value={mode}>{success}</WizardModeContext.Provider>;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (wizard.submitting) return;
    if (wizard.isLast) void wizard.submit();
    else void advance();
  };
  const step = wizard.current;
  const issues = showSummary ? summarizeErrors(errors) : [];
  const liveValid = steps.map((s) => !s.schema || s.schema.safeParse(values).success);
  const metas = withAttention(reconcileStepStatus(wizard.metas, liveValid, wizard.nav.current, wizard.nav.reached), attention?.(values) ?? []);

  return (
    <FormProvider {...wizard.form}>
      <div ref={rootRef} className="flex scroll-mt-4 flex-col gap-5">
        {header}
        <div className={main ? "hidden" : undefined}>
          <WizardStepper steps={metas} onSelect={wizard.goTo} />
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-5">
            {main}
            <div className={main ? "hidden" : "rounded-lg border border-border bg-surface p-5 shadow-xs"}>
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
                  {issues.length > 0 ? (
                    <Callout variant="error" title={`Fix ${issues.length} ${issues.length === 1 ? "field" : "fields"} to continue`}>
                      <ul role="list" className="mt-1 flex flex-col gap-0.5" data-testid="order-step-issues">
                        {issues.map((i) => (
                          <li key={i.path}>
                            <button type="button" className="text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => focusField(sectionRef.current, i.path)}>
                              {i.message}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  ) : null}
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
            {main ? null : below}
          </div>
          <div className={stickyRail ? "flex flex-col gap-4 lg:sticky lg:top-4" : "flex flex-col gap-4"}>{rail(values, wizard)}</div>
        </div>
      </div>
      <DirtyWatch wizard={wizard} onDirtyChange={onDirtyChange} />
      {draftScope ? <DraftFlush wizard={wizard} scope={draftScope} /> : null}
    </FormProvider>
  );
}
