/**
 * Pure wizard state: navigation rules per mode, step statuses and the draft codec.
 *   linear (create): a step is clickable only once it has been reached
 *   free   (edit):   every step is clickable
 */
import type { z } from 'zod';
import type { StepMeta, StepStatus, WizardMode } from './wizard-types';

export interface WizardNavState {
  readonly current: number;
  /** Highest step index the user has reached. */
  readonly reached: number;
  /** Step keys that passed validation on their last check. */
  readonly validated: readonly string[];
  /** Step keys whose last validation failed. */
  readonly attention: readonly string[];
}

export const initialNavState = (mode: WizardMode, stepCount: number): WizardNavState => ({
  current: 0,
  reached: mode === 'free' ? Math.max(stepCount - 1, 0) : 0,
  validated: [],
  attention: [],
});

export function canSelectStep(
  state: WizardNavState,
  index: number,
  mode: WizardMode,
  stepCount: number,
): boolean {
  if (index < 0 || index >= stepCount) return false;
  return mode === 'free' || index <= state.reached;
}

const without = (list: readonly string[], key: string): readonly string[] => list.filter((k) => k !== key);
const withKey = (list: readonly string[], key: string): readonly string[] =>
  list.includes(key) ? list : [...list, key];

export function markValidation(state: WizardNavState, key: string, ok: boolean): WizardNavState {
  return ok
    ? { ...state, validated: withKey(state.validated, key), attention: without(state.attention, key) }
    : { ...state, validated: without(state.validated, key), attention: withKey(state.attention, key) };
}

export function moveTo(state: WizardNavState, index: number): WizardNavState {
  return { ...state, current: index, reached: Math.max(state.reached, index) };
}

/**
 * `liveValid` = the step's schema passes on the current values. A valid step shows as
 * complete once it can be reached (free mode: always), so a prefilled edit form is checked.
 */
export function stepStatus(
  state: WizardNavState,
  key: string,
  index: number,
  liveValid = false,
  mode: WizardMode = 'linear',
): StepStatus {
  if (state.attention.includes(key)) return 'attention';
  if (index === state.current) return 'active';
  if (state.validated.includes(key)) return 'complete';
  if (liveValid && (mode === 'free' || index < state.reached)) return 'complete';
  return 'upcoming';
}

export function stepMetas(
  steps: readonly {
    readonly key: string;
    readonly label: string;
    readonly icon?: StepMeta['icon'];
    readonly isOptional?: boolean;
  }[],
  state: WizardNavState,
  mode: WizardMode,
  liveValid: readonly boolean[] = [],
): readonly StepMeta[] {
  return steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    icon: s.icon,
    isOptional: s.isOptional,
    status: stepStatus(state, s.key, i, liveValid[i] ?? false, mode),
    clickable: canSelectStep(state, i, mode, steps.length),
    current: i === state.current,
  }));
}

/** Percentage for the rail ring: validated steps over all steps. */
export function completionPercent(state: WizardNavState, stepCount: number): number {
  if (stepCount === 0) return 0;
  return Math.round((state.validated.length / stepCount) * 100);
}

/**
 * Rail ring from validity, not from visited steps: required steps whose schema passes on
 * the current values, over all required steps (optional steps never block 100%).
 */
export function validityPercent(
  steps: readonly { readonly isOptional?: boolean }[],
  liveValid: readonly boolean[],
  reached?: number,
): number {
  const required = steps.map((s, i) => ({ s, i })).filter(({ s }) => !s.isOptional);
  if (required.length === 0) return 100;
  // With `reached`, a step counts only once the user has visited it, so an untouched create
  // wizard starts at 0% whatever its defaults are (free/edit mode reaches every step).
  const valid = required.filter(
    ({ i }) => liveValid[i] === true && (reached === undefined || i <= reached),
  ).length;
  return Math.round((valid / required.length) * 100);
}

export const INCOMPLETE_SAVE_REASON = 'Complete required fields';

export interface StepIssue {
  readonly path: string;
  readonly message: string;
}

/** Runs a step schema against all values; returns field issues (empty = valid). */
export function validateStep(schema: z.ZodType | undefined, values: unknown): readonly StepIssue[] {
  if (!schema) return [];
  const result = schema.safeParse(values);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/* ---------------- draft persistence (sessionStorage) ---------------- */

export interface WizardDraft<T> {
  readonly v: 1;
  readonly values: T;
  readonly nav: WizardNavState;
}

export function draftKey(scope: string): string {
  return `ks:wizard-draft:${scope}`;
}

export function readDraft<T>(storage: Pick<Storage, 'getItem'> | null, scope: string): WizardDraft<T> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraft<T>>;
    if (parsed.v !== 1 || !parsed.values || !parsed.nav || typeof parsed.nav.current !== 'number')
      return null;
    return parsed as WizardDraft<T>;
  } catch {
    return null;
  }
}

export function writeDraft<T>(
  storage: Pick<Storage, 'setItem'> | null,
  scope: string,
  draft: Omit<WizardDraft<T>, 'v'>,
): void {
  if (!storage) return;
  try {
    storage.setItem(draftKey(scope), JSON.stringify({ v: 1, ...draft }));
  } catch {
    // Quota exceeded or storage disabled: the draft is a convenience, not a requirement.
  }
}

export function clearDraft(storage: Pick<Storage, 'removeItem'> | null, scope: string): void {
  try {
    storage?.removeItem(draftKey(scope));
  } catch {
    // Storage disabled; nothing to clear.
  }
}

export function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
