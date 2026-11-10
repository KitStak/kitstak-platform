"use client";

/**
 * Option sourcing for `Combobox`: static filtering or debounced async search with a
 * minimum-characters gate, plus a label cache so chips keep their text after the
 * result list changes.
 */
import * as React from "react";

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export type LoadOptions = (query: string, signal: AbortSignal) => Promise<readonly ComboboxOption[]>;

export const DEFAULT_ASYNC_MIN_CHARS = 3;
export const SEARCH_DEBOUNCE_MS = 250;

export function minCharsMessage(minChars: number): string {
  return `You have to enter at least ${minChars} characters to search.`;
}

/** Case-insensitive match on label, value and description; prefix matches first. */
export function filterOptions(options: readonly ComboboxOption[], query: string): readonly ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const scored: { option: ComboboxOption; score: number }[] = [];
  for (const option of options) {
    const label = option.label.toLowerCase();
    const haystack = `${label} ${option.value.toLowerCase()} ${(option.description ?? "").toLowerCase()}`;
    if (label.startsWith(q)) scored.push({ option, score: 0 });
    else if (haystack.includes(q)) scored.push({ option, score: 1 });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.option);
}

export interface OptionSourceState {
  readonly items: readonly ComboboxOption[];
  readonly loading: boolean;
  readonly error: string | null;
  /** Non-null when the query is shorter than `minChars`. */
  readonly hint: string | null;
}

export function useOptionSource({
  options,
  loadOptions,
  query,
  minChars,
  open,
}: {
  readonly options?: readonly ComboboxOption[];
  readonly loadOptions?: LoadOptions;
  readonly query: string;
  readonly minChars: number;
  readonly open: boolean;
}): OptionSourceState {
  const [asyncState, setAsyncState] = React.useState<{ readonly query: string; readonly items: readonly ComboboxOption[]; readonly error: string | null } | null>(null);
  const trimmed = query.trim();
  const belowMin = trimmed.length < minChars;
  const loadRef = React.useRef(loadOptions);
  React.useEffect(() => {
    loadRef.current = loadOptions;
  }, [loadOptions]);

  React.useEffect(() => {
    if (!loadRef.current || !open || belowMin) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const load = loadRef.current;
      if (!load) return;
      load(trimmed, controller.signal).then(
        (items) => setAsyncState({ query: trimmed, items, error: null }),
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setAsyncState({ query: trimmed, items: [], error: error instanceof Error ? error.message : "Search failed" });
        }
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, belowMin, open]);

  if (belowMin) return { items: loadOptions ? [] : filterOptions(options ?? [], query), loading: false, error: null, hint: minChars > 0 ? minCharsMessage(minChars) : null };
  if (!loadOptions) return { items: filterOptions(options ?? [], query), loading: false, error: null, hint: null };
  const fresh = asyncState?.query === trimmed;
  return { items: fresh ? asyncState.items : (asyncState?.items ?? []), loading: !fresh, error: fresh ? asyncState.error : null, hint: null };
}

/** Remembers every option ever seen so selected values always render a label. */
export interface LabelCache {
  readonly lookup: (value: string) => ComboboxOption;
  readonly remember: (option: ComboboxOption) => void;
}

export function useLabelCache(...sources: readonly (readonly ComboboxOption[] | undefined)[]): LabelCache {
  const [cache] = React.useState(() => new Map<string, ComboboxOption>());
  for (const source of sources) for (const option of source ?? []) cache.set(option.value, option);
  return React.useMemo<LabelCache>(
    () => ({
      lookup: (value) => cache.get(value) ?? { value, label: value },
      remember: (option) => {
        cache.set(option.value, option);
      },
    }),
    [cache]
  );
}
