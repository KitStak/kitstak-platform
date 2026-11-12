"use client";

/**
 * Light / dark / system theme. The choice lives in localStorage (per browser) and is applied as
 * `<html data-theme="light|dark">`, which globals.css keys its tokens on. THEME_INIT_SCRIPT runs
 * before first paint (root layout) so a dark-mode user never sees a light flash.
 */
import * as React from "react";
import { DARK_QUERY, THEME_STORAGE_KEY } from "./theme-script";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

const THEME_EVENT = "ks-theme-change";

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked (private mode): the theme still applies for this page view.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onSystem = (): void => {
    if (readPreference() === "system") applyTheme("system");
    onChange();
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(readPreference());
    onChange();
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
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
  const preference = React.useSyncExternalStore(subscribe, readPreference, () => "system" as const);
  const resolved = React.useSyncExternalStore(
    subscribe,
    () => resolveTheme(readPreference()),
    () => "light" as const,
  );
  return { preference, resolved, setPreference: setThemePreference };
}
