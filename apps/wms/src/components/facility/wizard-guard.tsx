"use client";

/**
 * Server-error routing for the M10 drawer wizards (critic R1: a 409 on Save left the user on
 * the last step with no visible error).
 *
 * - `guard(schema, owns)` wraps a step schema so a value the server rejected (duplicate code,
 *   taken prefix, invalid lookup) stays invalid until the user changes it.
 * - `handleServerError` records the rejected values and re-runs Save on the next frame. The
 *   shared wizard then validates every step, jumps to the step that owns the field, marks its
 *   pill and focuses the field, and the caller keeps an inline banner on screen.
 * - `useAvailabilityCheck` checks uniqueness while the user types (debounced, also on blur),
 *   so a taken code shows inline on step 1 and Next is blocked there, as Logiwa does.
 */
import * as React from "react";
import { z } from "zod";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { apiRequest, isApiError } from "@/lib/api-client";
import { apiErrorMessage } from "./facility-shared";

type Owns = (path: string) => boolean;
interface Taken { readonly value: string; readonly message: string }

const norm = (v: unknown): string => (v === null || v === undefined ? "" : String(v)).trim().toLowerCase();

function valueAt(values: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), values);
}

/** Issues the wrapped schema reports for values the server already rejected. Pure; exported for tests. */
export function takenIssues(taken: ReadonlyMap<string, Taken>, owns: Owns, values: unknown): readonly { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  for (const [path, t] of taken) {
    if (!owns(path)) continue;
    const current = norm(valueAt(values, path));
    if (current && current === t.value) out.push({ path, message: t.message });
  }
  return out;
}

export interface WizardGuard {
  readonly rootRef: React.RefObject<HTMLDivElement | null>;
  /** Persistent inline error (server message) shown above the wizard until the next save. */
  readonly banner: string | null;
  readonly dismissBanner: () => void;
  readonly guard: (schema: z.ZodType | undefined, owns: Owns) => z.ZodType;
  /** Records server field errors and re-validates; returns true when a field was routed to its step. */
  readonly handleServerError: (error: unknown, values: unknown) => boolean;
  readonly markTaken: (path: string, value: unknown, message: string) => void;
  readonly clearTaken: (path: string) => void;
}

/** Clicks the wizard's Save (the only footer button with aria-busy) once it is enabled again. */
function clickSaveWhenEnabled(root: HTMLElement | null, tries = 30): void {
  if (!root || tries <= 0) return;
  const save = root.querySelector<HTMLButtonElement>("button[aria-busy]");
  if (save && !save.disabled) {
    save.click();
    return;
  }
  requestAnimationFrame(() => clickSaveWhenEnabled(root, tries - 1));
}

export function useWizardGuard(): WizardGuard {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const taken = React.useRef(new Map<string, Taken>());
  const owners = React.useRef<Owns[]>([]);
  const [banner, setBanner] = React.useState<string | null>(null);

  const guard = React.useCallback((schema: z.ZodType | undefined, owns: Owns): z.ZodType => {
    owners.current.push(owns);
    return z.unknown().superRefine((values, ctx) => {
      if (schema) {
        const result = schema.safeParse(values);
        if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: "custom", path: issue.path as (string | number)[], message: issue.message });
      }
      for (const issue of takenIssues(taken.current, owns, values)) ctx.addIssue({ code: "custom", path: issue.path.split("."), message: issue.message });
    });
  }, []);

  const markTaken = React.useCallback((path: string, value: unknown, message: string) => {
    taken.current.set(path, { value: norm(value), message });
  }, []);
  const clearTaken = React.useCallback((path: string) => {
    taken.current.delete(path);
  }, []);

  const handleServerError = React.useCallback((error: unknown, values: unknown): boolean => {
    setBanner(apiErrorMessage(error));
    if (!isApiError(error)) return false;
    let routed = false;
    for (const [path, messages] of Object.entries(error.fieldErrors)) {
      const message = messages[0];
      if (!message || !owners.current.some((owns) => owns(path))) continue;
      const value = valueAt(values, path);
      if (norm(value) === "") continue;
      markTaken(path, value, message);
      routed = true;
    }
    if (routed) requestAnimationFrame(() => clickSaveWhenEnabled(rootRef.current));
    return routed;
  }, [markTaken]);

  return { rootRef, banner, dismissBanner: () => setBanner(null), guard, handleServerError, markTaken, clearTaken };
}

/**
 * Debounced uniqueness check against `GET <url>` (`{ taken: { path: message } }`). Shows the
 * message inline (error type "taken") and records it so Next is blocked; clears it once free.
 */
export function useAvailabilityCheck<T extends FieldValues>(
  wizardGuard: WizardGuard,
  form: UseFormReturn<T>,
  { url, paths, params }: { readonly url: string; readonly paths: readonly Path<T>[]; readonly params: (values: T) => Record<string, string | undefined> | null },
): { readonly checking: boolean } {
  const [checking, setChecking] = React.useState(false);
  const watched = form.watch(paths as Path<T>[]);
  const key = JSON.stringify(watched);
  const paramsRef = React.useRef(params);
  React.useEffect(() => {
    paramsRef.current = params;
  });
  React.useEffect(() => {
    const query = paramsRef.current(form.getValues());
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      apiRequest<{ taken: Record<string, string> }>(url, { query, signal: controller.signal })
        .then(({ data }) => {
          for (const path of paths) {
            const message = data.taken[path];
            const state = form.getFieldState(path);
            if (message) {
              wizardGuard.markTaken(path, form.getValues(path), message);
              form.setError(path, { type: "taken", message });
            } else {
              wizardGuard.clearTaken(path);
              if (state.error?.type === "taken" || state.error?.type === "server") form.clearErrors(path);
            }
          }
        })
        .catch(() => {
          // A failed pre-check never blocks the user; Save re-checks on the server.
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` captures the watched values; paths/url are static per wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);
  return { checking };
}
