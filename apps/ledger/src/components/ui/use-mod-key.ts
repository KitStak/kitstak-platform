'use client';
import { useSyncExternalStore } from 'react';
import { modKey } from './kbd';

const subscribe = () => () => undefined;

/** Hydration-safe platform modifier label ('⌘' on Apple, 'Ctrl' elsewhere). */
export function useModKey(): string {
  return useSyncExternalStore(subscribe, modKey, () => 'Ctrl');
}
