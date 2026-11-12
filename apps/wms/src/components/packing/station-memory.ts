"use client";

/**
 * Remembers a user's station choices (warehouse, station, target) per user so the station
 * opens ready to scan. The source of truth is the user's preferences on the server
 * (`preferences.stations[kind]`, REQ-3, follows the user across devices); local storage is
 * the instant / offline fallback. Writes go to both (the PATCH is fire-and-forget).
 */
import * as React from "react";
import { apiRequest } from "@/lib/api-client";
import { useMe } from "@/lib/permissions-client";

type Kind = "packing" | "returns";

export function useStationMemory<T extends object>(kind: Kind, initial: T): readonly [T, (patch: Partial<T>) => void, boolean] {
  const me = useMe();
  const userId = me.data?.data.user.id ?? null;
  const server = (me.data?.data.preferences as { readonly stations?: Partial<Record<Kind, Partial<T>>> } | undefined)?.stations?.[kind];
  const key = userId ? `kitstaks.station.${kind}.${userId}` : null;
  const [value, setValue] = React.useState<T>(initial);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!key || ready) return;
    let local: Partial<T> = {};
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) local = JSON.parse(raw) as Partial<T>;
    } catch {
      /* unreadable storage: start empty */
    }
    // Server preferences win (they follow the user); local storage fills what the server lacks.
    setValue((v) => ({ ...v, ...local, ...(server ?? {}) }));
    setReady(true);
  }, [key, ready, server]);

  const update = React.useCallback((patch: Partial<T>) => {
    setValue((v) => {
      const next = { ...v, ...patch };
      if (key) {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage full or blocked: the choice still applies for this visit */
        }
        void apiRequest("/api/me", { method: "PATCH", body: { preferences: { stations: { [kind]: next } } } }).catch(() => {
          /* offline / rejected: local storage still remembers it on this device */
        });
      }
      return next;
    });
  }, [key, kind]);

  return [value, update, ready] as const;
}
