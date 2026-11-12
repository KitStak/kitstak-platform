'use client';

/**
 * Toast store (BUILD_PLAN F4.2). Framework-free so non-React code (query-client,
 * api helpers) can raise toasts: `toast.success("Saved", "Order SO000123 updated")`.
 * Rendered by `<Toaster />` (toaster.tsx), top centre below the header, 5 s auto-dismiss, paused on hover.
 */
import * as React from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastItem {
  readonly id: string;
  readonly variant: ToastVariant;
  readonly title: string;
  readonly message?: string;
  readonly action?: ToastAction;
  /** ms; default 5000. `Infinity` keeps it until dismissed. */
  readonly duration: number;
}

export interface ToastInput {
  readonly variant?: ToastVariant;
  readonly title?: string;
  readonly message?: string;
  readonly action?: ToastAction;
  readonly duration?: number;
  /** Re-using an id replaces that toast instead of stacking a new one. */
  readonly id?: string;
}

export const TOAST_DEFAULT_DURATION = 5000;
export const TOAST_LIMIT = 5;

const DEFAULT_TITLES: Readonly<Record<ToastVariant, string>> = {
  success: 'Success',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

type Listener = () => void;

let items: readonly ToastItem[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit(next: readonly ToastItem[]): void {
  items = next;
  for (const listener of listeners) listener();
}

export function showToast(input: ToastInput): string {
  counter += 1;
  const variant = input.variant ?? 'info';
  const item: ToastItem = {
    id: input.id ?? `toast-${counter}`,
    variant,
    title: input.title ?? DEFAULT_TITLES[variant],
    message: input.message,
    action: input.action,
    duration: input.duration ?? TOAST_DEFAULT_DURATION,
  };
  const without = items.filter((t) => t.id !== item.id);
  emit([...without, item].slice(-TOAST_LIMIT));
  return item.id;
}

export function dismissToast(id?: string): void {
  emit(id === undefined ? [] : items.filter((t) => t.id !== id));
}

type ShortcutInput = Omit<ToastInput, 'variant' | 'title' | 'message'>;

function shortcut(variant: ToastVariant) {
  return (title: string, message?: string, options: ShortcutInput = {}): string =>
    showToast({ ...options, variant, title, message });
}

export const toast = {
  show: showToast,
  success: shortcut('success'),
  error: shortcut('error'),
  warning: shortcut('warning'),
  info: shortcut('info'),
  dismiss: dismissToast,
} as const;

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: readonly ToastItem[] = [];

export function useToasts(): readonly ToastItem[] {
  return React.useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );
}

/** Hook form for components: `const { toast } = useToast()`. */
export function useToast(): { readonly toast: typeof toast; readonly dismiss: typeof dismissToast } {
  return { toast, dismiss: dismissToast };
}
