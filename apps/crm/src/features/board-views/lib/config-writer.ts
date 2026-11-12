/**
 * Coalescing, serialized writer for a view-config slice. Edits are merged into one pending
 * slice and flushed after `delayMs` of quiet; at most one request is in flight, and a response is
 * only reported as authoritative when no newer edit is pending or in flight — so out-of-order
 * responses can never clobber what the user typed after them.
 */
export interface ConfigWriterOptions<T> {
  readonly delayMs: number;
  readonly send: (slice: T) => Promise<unknown>;
  /** Called with the server result only when it reflects the latest local state. */
  readonly onSettled?: (result: unknown) => void;
  readonly onError?: (error: unknown) => void;
  readonly onBusyChange?: (busy: boolean) => void;
}

export interface ConfigWriter<T> {
  /** Merge `patch` into the pending slice (based on `base` if nothing is pending). Returns it. */
  readonly edit: (base: T, patch: Partial<T>, immediate?: boolean) => T;
  readonly flush: () => void;
  readonly pending: () => T | null;
  readonly dispose: () => void;
}

export function createConfigWriter<T extends Record<string, unknown>>(options: ConfigWriterOptions<T>): ConfigWriter<T> {
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = (): void => {
    clearTimer();
    if (inFlight || !pending) return;
    const slice = pending;
    pending = null;
    inFlight = true;
    options.onBusyChange?.(true);
    options
      .send(slice)
      .then((result) => {
        if (!pending) options.onSettled?.(result);
      })
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        inFlight = false;
        if (pending) flush();
        else options.onBusyChange?.(false);
      });
  };

  return {
    edit(base, patch, immediate = false) {
      const next = { ...(pending ?? base), ...patch } as T;
      pending = next;
      clearTimer();
      if (immediate) flush();
      else timer = setTimeout(flush, options.delayMs);
      return next;
    },
    flush,
    pending: () => pending,
    dispose: () => flush(),
  };
}
