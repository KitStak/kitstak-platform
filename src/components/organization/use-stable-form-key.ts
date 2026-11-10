"use client";

import * as React from "react";

/**
 * Returns `value` while the form is pristine and the last pristine value once it is dirty.
 * Edit drawers key their form on `${id}-${dataUpdatedAt}` and pass the loaded record (and
 * its version) down: freezing both means a background refetch never resets the form or
 * silently bumps the version the user's save is checked against.
 */
export function useFrozenWhileDirty<T>(value: T, dirty: boolean): T {
  const ref = React.useRef<{ readonly v: T } | null>(null);
  if (!dirty || !ref.current) ref.current = { v: value };
  return ref.current.v;
}
