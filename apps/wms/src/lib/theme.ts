'use client';

/**
 * Light / dark / system theme, unified with KitStak CRM through @kitstak/ui/theme.
 * The preference persists to BOTH shared stores (cookie 'kitstak-theme' — which wins —
 * and localStorage 'kitstak-theme') and is applied as `<html data-theme="light|dark">`,
 * which the shared tokens.css keys on. THEME_INIT_SCRIPT runs before first paint
 * (root layout) so a dark-mode user never sees a light flash.
 *
 * Migration: the pre-unification 'ks-theme' localStorage key is still read when the
 * shared stores are empty, so existing users keep their preference; the next explicit
 * change writes the shared stores and clears the legacy key.
 */
import * as React from 'react';
import {
  DARK_QUERY,
  parseStoredTheme,
  persistTheme,
  THEME_COOKIE,
  THEME_STORAGE_KEY,
} from '@kitstak/ui/theme';
import { LEGACY_THEME_STORAGE_KEY } from './theme-script';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

const THEME_EVENT = 'ks-theme-change';
const COOKIE_PATTERN = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`);

function readCookieTheme(): ResolvedTheme | null {
  const match = COOKIE_PATTERN.exec(document.cookie);
  return parseStoredTheme(match?.[1] === undefined ? null : decodeURIComponent(match[1]));
}

function readStorageTheme(key: string): ResolvedTheme | null {
  try {
    return parseStoredTheme(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

function readPreference(): ThemePreference {
  return (
    readCookieTheme() ??
    readStorageTheme(THEME_STORAGE_KEY) ??
    readStorageTheme(LEGACY_THEME_STORAGE_KEY) ??
    'system'
  );
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  persistTheme(preference);
  try {
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the cookie still carries the preference.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onSystem = (): void => {
    if (readPreference() === 'system') applyTheme('system');
    onChange();
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readPreference());
    onChange();
  };
  media.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    media.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

interface ThemeState {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

/** Current theme preference + resolved theme; stays in sync across tabs and OS changes. */
export function useTheme(): ThemeState {
  const preference = React.useSyncExternalStore(subscribe, readPreference, () => 'system' as const);
  const resolved = React.useSyncExternalStore(
    subscribe,
    () => resolveTheme(readPreference()),
    () => 'light' as const,
  );
  return { preference, resolved, setPreference: setThemePreference };
}
