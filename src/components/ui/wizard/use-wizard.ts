"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { focusFirstError } from "../form/form";
import type { StepMeta, WizardMode, WizardStep } from "./wizard-types";
import {
  canSelectStep,
  clearDraft,
  initialNavState,
  INCOMPLETE_SAVE_REASON,
  markValidation,
  moveTo,
  readDraft,
  sessionStorageOrNull,
  stepMetas,
  validateStep,
  validityPercent,
  writeDraft,
  type StepIssue,
  type WizardNavState,
} from "./wizard-state";

const DRAFT_DEBOUNCE_MS = 300;

export interface UseWizardOptions<T extends FieldValues> {
  readonly steps: readonly WizardStep<T>[];
  readonly mode: WizardMode;
  readonly defaultValues: DefaultValues<T>;
  /** sessionStorage scope; defaults to the current route. `false` disables drafts. */
  readonly draftScope?: string | false;
  readonly onComplete: (values: T) => unknown | Promise<unknown>;
  /** Element wrapping the wizard, used to focus the first invalid control. */
  readonly rootRef?: React.RefObject<HTMLElement | null>;
}

export interface WizardController<T extends FieldValues> {
  readonly form: UseFormReturn<T>;
  readonly nav: WizardNavState;
  readonly metas: readonly StepMeta[];
  readonly current: WizardStep<T>;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly percent: number;
  /** Why the rail's Save is disabled (required steps still invalid), or null. */
  readonly saveDisabledReason: string | null;
  readonly submitting: boolean;
  readonly completed: boolean;
  readonly restoredDraft: boolean;
  readonly next: () => Promise<boolean>;
  readonly back: () => void;
  readonly goTo: (key: string) => void;
  readonly submit: () => Promise<boolean>;
  readonly discardDraft: () => void;
  /** Clears the draft and returns to step 1 with the default values. */
  readonly restart: () => void;
}

export function useWizard<T extends FieldValues>({ steps, mode, defaultValues, draftScope, onComplete, rootRef }: UseWizardOptions<T>): WizardController<T> {
  const pathname = usePathname();
  const scope = draftScope === false ? null : (draftScope ?? pathname);
  const form = useForm<T>({ defaultValues, mode: "onTouched" });
  const [nav, setNav] = React.useState<WizardNavState>(() => initialNavState(mode, steps.length));
  const [submitting, setSubmitting] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);
  const [restoredDraft, setRestoredDraft] = React.useState(false);
  const errorPaths = React.useRef(new Map<string, readonly string[]>());
  const navRef = React.useRef(nav);
  React.useEffect(() => {
    navRef.current = nav;
  }, [nav]);

  /* Restore a draft once, after mount (sessionStorage is client-only). */
  React.useEffect(() => {
    if (!scope) return;
    const draft = readDraft<T>(sessionStorageOrNull(), scope);
    if (!draft) return;
    form.reset(draft.values, { keepDefaultValues: true });
    setNav({ ...draft.nav, current: Math.min(draft.nav.current, steps.length - 1) });
    setRestoredDraft(true);
    // Run once per scope; steps/form are stable for a mounted wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  /* Persist values + navigation (debounced). */
  React.useEffect(() => {
    if (!scope || completed) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => writeDraft(sessionStorageOrNull(), scope, { values: form.getValues(), nav: navRef.current });
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, DRAFT_DEBOUNCE_MS);
    };
    const sub = form.watch(() => {
      if (form.formState.isDirty) schedule();
    });
    if (form.formState.isDirty) schedule();
    return () => {
      sub.unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [form, scope, completed, nav]);

  const applyIssues = React.useCallback(
    (step: WizardStep<T>, issues: readonly StepIssue[]) => {
      const previous = errorPaths.current.get(step.key) ?? [];
      const nextPaths = issues.map((i) => i.path);
      for (const path of previous) if (!nextPaths.includes(path)) form.clearErrors(path as Path<T>);
      // The first issue per field wins (schemas list their most basic rule first, e.g. "required").
      const seen = new Set<string>();
      for (const issue of issues) {
        if (seen.has(issue.path)) continue;
        seen.add(issue.path);
        form.setError(issue.path as Path<T>, { type: "step", message: issue.message });
      }
      errorPaths.current.set(step.key, nextPaths);
    },
    [form]
  );

  const check = React.useCallback(
    (index: number): boolean => {
      const step = steps[index];
      if (!step) return true;
      const issues = validateStep(step.schema, form.getValues());
      applyIssues(step, issues);
      setNav((s) => markValidation(s, step.key, issues.length === 0));
      return issues.length === 0;
    },
    [steps, form, applyIssues]
  );

  /* Live re-validation of a step that is flagged, so errors clear as the user fixes them. */
  React.useEffect(() => {
    const sub = form.watch(() => {
      const step = steps[navRef.current.current];
      if (step && navRef.current.attention.includes(step.key)) check(navRef.current.current);
    });
    return () => sub.unsubscribe();
  }, [form, steps, check]);

  const focusError = React.useCallback(() => {
    requestAnimationFrame(() => focusFirstError(rootRef?.current ?? null, form.formState.errors));
  }, [form, rootRef]);

  const goTo = React.useCallback(
    (key: string) => {
      const index = steps.findIndex((s) => s.key === key);
      if (!canSelectStep(navRef.current, index, mode, steps.length)) return;
      if (mode === "free" || index < navRef.current.current) check(navRef.current.current);
      setNav((s) => moveTo(s, index));
    },
    [steps, mode, check]
  );

  const next = React.useCallback(async () => {
    const index = navRef.current.current;
    if (!check(index)) {
      focusError();
      return false;
    }
    if (index < steps.length - 1) setNav((s) => moveTo(s, index + 1));
    return true;
  }, [check, focusError, steps.length]);

  const back = React.useCallback(() => {
    const index = navRef.current.current;
    if (index > 0) setNav((s) => moveTo(s, index - 1));
  }, []);

  const discardDraft = React.useCallback(() => {
    if (scope) clearDraft(sessionStorageOrNull(), scope);
  }, [scope]);

  const restart = React.useCallback(() => {
    discardDraft();
    errorPaths.current.clear();
    form.reset(defaultValues);
    setNav(initialNavState(mode, steps.length));
    setRestoredDraft(false);
  }, [discardDraft, form, defaultValues, mode, steps.length]);

  const submit = React.useCallback(async () => {
    const failed = steps.map((_, i) => i).filter((i) => !check(i));
    if (failed.length) {
      const first = failed[0] as number;
      setNav((s) => moveTo(s, first));
      focusError();
      return false;
    }
    setSubmitting(true);
    try {
      await onComplete(form.getValues());
      discardDraft();
      setCompleted(true);
      return true;
    } catch {
      // The caller surfaces the failure (toast / server field errors via applyServerFieldErrors).
      focusError();
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [steps, check, focusError, onComplete, form, discardDraft]);

  const current = steps[nav.current] ?? (steps[0] as WizardStep<T>);
  // Re-evaluated every render; the Wizard watches the form so edits re-render it.
  const liveValues = form.getValues();
  const liveValid = steps.map((s) => validateStep(s.schema, liveValues).length === 0);
  const percent = validityPercent(steps, liveValid);
  return {
    form,
    nav,
    metas: stepMetas(steps, nav, mode, liveValid),
    current,
    isFirst: nav.current === 0,
    isLast: nav.current === steps.length - 1,
    percent,
    saveDisabledReason: percent >= 100 ? null : INCOMPLETE_SAVE_REASON,
    submitting,
    completed,
    restoredDraft,
    next,
    back,
    goTo,
    submit,
    discardDraft,
    restart,
  };
}
