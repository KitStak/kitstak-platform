"use client";

/**
 * Remembers a user's station choices (warehouse, station, target) per user in local
 * storage so the station opens ready to scan. Server-side persistence (follows the user
 * across devices) is requested in docs/requests/stations-returns.md REQ-3; this adapter
 * keeps the same interface so only its body changes when that lands.
 */
import * as React from "react";
import { useMe } from "@/lib/permissions-client";

export function useStationMemory<T extends object>(kind: "packing" | "returns", initial: T): readonly [T, (patch: Partial<T>) => void, boolean] {
  const me = useMe();
  const userId = me.data?.data.user.id ?? null;
  const key = userId ? `kitstaks.station.${kind}.${userId}` : null;
  const [value, setValue] = React.useState<T>(initial);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!key || ready) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue((v) => ({ ...v, ...(JSON.parse(raw) as Partial<T>) }));
    } catch {
      /* unreadable storage: start empty */
    }
    setReady(true);
  }, [key, ready]);

  const update = React.useCallback((patch: Partial<T>) => {
    setValue((v) => {
      const next = { ...v, ...patch };
      if (key) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage full or blocked: the choice still applies for this visit */
        }
      }
      return next;
    });
  }, [key]);

  return [value, update, ready] as const;
}
