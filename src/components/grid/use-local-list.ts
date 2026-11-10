"use client";

/**
 * Small per-viewer string list in localStorage (e.g. pinned filter fields). Storage
 * can be unavailable (private mode, blocked site data): every access is guarded and
 * the hook degrades to in-memory state.
 */
import * as React from "react";
import { z } from "zod";

const listSchema = z.array(z.string().max(200)).max(200);

function read(key: string): readonly string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = listSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(key: string, value: readonly string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the in-memory value still applies for this session.
  }
}

export function useLocalList(key: string): readonly [readonly string[], (next: readonly string[]) => void] {
  const [value, setValue] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    // Hydrate after mount so server and first client render match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(read(key));
  }, [key]);
  const set = React.useCallback(
    (next: readonly string[]) => {
      setValue(next);
      write(key, next);
    },
    [key]
  );
  return [value, set] as const;
}
