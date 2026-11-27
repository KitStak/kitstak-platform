'use client';
/**
 * Call a server action from a client component with pending state, error toasts and cache
 * invalidation:
 *
 *   const update = useServerAction(updateTaskAction, { invalidate: [qk.projectTasks(key)] });
 *   await update.run({ taskId, patch: { priority: 'high' } });   // returns data | undefined
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import type { ActionResult } from '@/server/actions/_action';

export interface ServerActionOptions<T> {
  /** Toast on success (string or builder). */
  readonly successMessage?: string | ((data: T) => string);
  /** Toast title used for failures (default "Couldn't save your change"). */
  readonly errorTitle?: string;
  /** Query keys to invalidate after success. */
  readonly invalidate?: readonly QueryKey[];
  readonly onSuccess?: (data: T) => void | Promise<void>;
  readonly onError?: (error: { code: string; message: string; fields?: Readonly<Record<string, string>> }) => void;
  /** Suppress the error toast (caller renders field errors itself). */
  readonly silentError?: boolean;
}

export function useServerAction<I, T>(action: (input: I) => Promise<ActionResult<T>>, options: ServerActionOptions<T> = {}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Latest options, read at call time (callbacks close over fresh component state).
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const run = useCallback(
    async (input: I): Promise<T | undefined> => {
      const options = optionsRef.current;
      setPending(true);
      setFieldErrors({});
      try {
        const result = await action(input);
        if (!result.ok) {
          setFieldErrors(result.error.fields ?? {});
          options.onError?.(result.error);
          if (!options.silentError) toast.error(options.errorTitle ?? "Couldn't save your change", result.error.message);
          return undefined;
        }
        for (const key of options.invalidate ?? []) await queryClient.invalidateQueries({ queryKey: key });
        if (options.successMessage) {
          toast.success(typeof options.successMessage === 'function' ? options.successMessage(result.data) : options.successMessage);
        }
        await options.onSuccess?.(result.data);
        startTransition(() => {});
        return result.data;
      } catch {
        if (!options.silentError) toast.error(options.errorTitle ?? "Couldn't save your change", 'Check your connection and try again.');
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [action, queryClient],
  );

  return { run, pending, fieldErrors } as const;
}

/** Unwraps an ActionResult or throws (for React Query mutationFn). */
export async function unwrap<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    const error = new Error(result.error.message) as Error & { code?: string; fields?: Readonly<Record<string, string>> };
    error.code = result.error.code;
    error.fields = result.error.fields;
    throw error;
  }
  return result.data;
}
