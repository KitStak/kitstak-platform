'use client';

/**
 * Keyboard shortcut registry (BUILD_PLAN F4.1).
 *
 *   useShortcut("mod+k", openSearch, { description: "Open search", group: "Global" });
 *   listShortcuts()  → for the "Keyboard shortcuts" help dialog
 *
 * Combos: modifiers `mod` (⌘ on macOS, Ctrl elsewhere), `ctrl`, `meta`, `alt`, `shift`
 * joined with "+", then a key (`k`, `/`, `enter`, `escape`, `arrowdown`, `f2`, `?`).
 * One window listener serves every registration; the most recent registration for a
 * combo wins (so a dialog can shadow a page shortcut while it is open).
 */
import * as React from 'react';

export interface ParsedCombo {
  readonly key: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface ShortcutOptions {
  readonly description?: string;
  readonly group?: string;
  /** Fire while focus is in an input/textarea/contenteditable. Default false. */
  readonly allowInInputs?: boolean;
  /** Call preventDefault on match. Default true. */
  readonly preventDefault?: boolean;
  readonly enabled?: boolean;
}

export interface ShortcutRegistration extends Required<Omit<ShortcutOptions, 'enabled'>> {
  readonly id: number;
  readonly combo: string;
  readonly parsed: ParsedCombo;
  readonly handler: (event: KeyboardEvent) => void;
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  plus: '+',
};

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function parseCombo(combo: string, mac = isMacPlatform()): ParsedCombo {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim());
  // "mod++" → last token is empty because "+" itself was the key.
  const rawKey = combo.endsWith('++') ? '+' : (parts.pop() ?? '');
  const mods = new Set(parts.filter(Boolean));
  const key = KEY_ALIASES[rawKey] ?? rawKey;
  return {
    key,
    ctrl: mods.has('ctrl') || (mods.has('mod') && !mac),
    meta: mods.has('meta') || mods.has('cmd') || (mods.has('mod') && mac),
    alt: mods.has('alt') || mods.has('option'),
    shift: mods.has('shift'),
  };
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** Shift is ignored for printable symbols ("?" already implies shift). */
export function matchesCombo(event: KeyLike, combo: ParsedCombo): boolean {
  const key = event.key.toLowerCase();
  if (key !== combo.key) return false;
  const symbol = combo.key.length === 1 && !/[a-z0-9]/.test(combo.key);
  return (
    event.ctrlKey === combo.ctrl &&
    event.metaKey === combo.meta &&
    event.altKey === combo.alt &&
    (symbol || event.shiftKey === combo.shift)
  );
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  enter: 'Enter',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  delete: 'Del',
  backspace: '⌫',
  tab: 'Tab',
};

/** Display tokens, e.g. ["⌘", "K"] or ["Ctrl", "K"]. */
export function comboTokens(combo: string, mac = isMacPlatform()): readonly string[] {
  const p = parseCombo(combo, mac);
  const tokens: string[] = [];
  if (p.ctrl) tokens.push(mac ? '⌃' : 'Ctrl');
  if (p.alt) tokens.push(mac ? '⌥' : 'Alt');
  if (p.shift) tokens.push(mac ? '⇧' : 'Shift');
  if (p.meta) tokens.push(mac ? '⌘' : 'Win');
  tokens.push(
    KEY_LABELS[p.key] ??
      (p.key.length === 1 ? p.key.toUpperCase() : p.key.charAt(0).toUpperCase() + p.key.slice(1)),
  );
  return tokens;
}

export function formatCombo(combo: string, mac = isMacPlatform()): string {
  return comboTokens(combo, mac).join(mac ? '' : '+');
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

/* ---------------- registry ---------------- */

let registrations: readonly ShortcutRegistration[] = [];
let nextId = 1;
let listening = false;
const changeListeners = new Set<() => void>();

const EMPTY_LIST: readonly ShortcutRegistration[] = [];
let snapshot: readonly ShortcutRegistration[] = EMPTY_LIST;

function notify(): void {
  snapshot = computeShortcutList();
  for (const listener of changeListeners) listener();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const editable = isEditableTarget(event.target);
  for (let i = registrations.length - 1; i >= 0; i -= 1) {
    const reg = registrations[i];
    if (!reg || (editable && !reg.allowInInputs) || !matchesCombo(event, reg.parsed)) continue;
    if (reg.preventDefault) event.preventDefault();
    reg.handler(event);
    return;
  }
}

function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown);
  listening = true;
}

function maybeRemoveListener(): void {
  if (!listening || registrations.length > 0 || typeof window === 'undefined') return;
  window.removeEventListener('keydown', onKeyDown);
  listening = false;
}

/** Registers a shortcut; returns the unregister function. */
export function registerShortcut(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): () => void {
  const reg: ShortcutRegistration = {
    id: nextId++,
    combo,
    parsed: parseCombo(combo),
    handler,
    description: options.description ?? '',
    group: options.group ?? 'General',
    allowInInputs: options.allowInInputs ?? false,
    preventDefault: options.preventDefault ?? true,
  };
  registrations = [...registrations, reg];
  ensureListener();
  notify();
  return () => {
    registrations = registrations.filter((r) => r.id !== reg.id);
    maybeRemoveListener();
    notify();
  };
}

/** Described shortcuts, newest registration per combo, grouped order preserved. */
export function listShortcuts(): readonly ShortcutRegistration[] {
  return snapshot;
}

function computeShortcutList(): readonly ShortcutRegistration[] {
  const seen = new Set<string>();
  const out: ShortcutRegistration[] = [];
  for (let i = registrations.length - 1; i >= 0; i -= 1) {
    const reg = registrations[i];
    if (!reg || !reg.description || seen.has(reg.combo)) continue;
    seen.add(reg.combo);
    out.unshift(reg);
  }
  return out;
}

export function subscribeShortcuts(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Binds a shortcut for the component's lifetime. The latest `handler` is always used. */
export function useShortcut(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): void {
  const handlerRef = React.useRef(handler);
  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  const { enabled = true, description, group, allowInInputs, preventDefault } = options;
  React.useEffect(() => {
    if (!enabled) return undefined;
    return registerShortcut(combo, (event) => handlerRef.current(event), {
      description,
      group,
      allowInInputs,
      preventDefault,
    });
  }, [combo, enabled, description, group, allowInInputs, preventDefault]);
}

/** Live list for a help dialog. */
export function useShortcutList(): readonly ShortcutRegistration[] {
  return React.useSyncExternalStore(subscribeShortcuts, listShortcuts, () => EMPTY_LIST);
}
