'use client';

/**
 * Keyboard-wedge barcode detection (BUILD_PLAN F4.1). Hand scanners "type" the code
 * very fast and finish with Enter (or Tab). A burst of ≥ `minLength` printable keys,
 * each within `maxIntervalMs` of the previous one, terminated by an end key, is a scan.
 * Human typing is slower than the interval, so it never triggers.
 *
 *   useBarcodeScanner((code) => receive(code), { enabled: drawerOpen });
 */
import * as React from 'react';
import { isEditableTarget } from './keyboard';

export interface ScanOptions {
  /** Minimum characters for a burst to count as a scan. Default 4. */
  readonly minLength?: number;
  /** Max gap between keystrokes inside a scan, ms. Default 35. */
  readonly maxIntervalMs?: number;
  /** Keys that end a scan. Default Enter and Tab. */
  readonly endKeys?: readonly string[];
  /** Also detect while an input has focus (its value is left untouched). Default false. */
  readonly allowInInputs?: boolean;
  /** Prevent the terminating key's default (form submit / focus move) on a scan. Default true. */
  readonly preventEndKeyDefault?: boolean;
}

export interface ScanKeyEvent {
  readonly key: string;
  readonly timeStamp: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

export const SCAN_DEFAULTS = {
  minLength: 4,
  maxIntervalMs: 35,
  endKeys: ['Enter', 'Tab'],
} as const;

export interface ScanDetector {
  /** Feed a keydown; returns the scanned code when this key completes a scan. */
  readonly feed: (event: ScanKeyEvent) => string | null;
  readonly reset: () => void;
}

/** Pure, timer-free detector (uses the events' own timestamps). */
export function createScanDetector(options: ScanOptions = {}): ScanDetector {
  const minLength = options.minLength ?? SCAN_DEFAULTS.minLength;
  const maxInterval = options.maxIntervalMs ?? SCAN_DEFAULTS.maxIntervalMs;
  const endKeys = options.endKeys ?? SCAN_DEFAULTS.endKeys;
  let buffer = '';
  let lastTime = -Infinity;

  const reset = (): void => {
    buffer = '';
    lastTime = -Infinity;
  };

  const feed = (event: ScanKeyEvent): string | null => {
    const gap = event.timeStamp - lastTime;
    if (endKeys.includes(event.key)) {
      const code = buffer;
      const fast = gap <= maxInterval;
      reset();
      return fast && code.length >= minLength ? code : null;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
      reset();
      return null;
    }
    buffer = gap <= maxInterval ? buffer + event.key : event.key;
    lastTime = event.timeStamp;
    return null;
  };

  return { feed, reset };
}

export function useBarcodeScanner(
  onScan: (code: string) => void,
  options: ScanOptions & { readonly enabled?: boolean } = {},
): void {
  const onScanRef = React.useRef(onScan);
  React.useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  const {
    enabled = true,
    minLength,
    maxIntervalMs,
    endKeys,
    allowInInputs = false,
    preventEndKeyDefault = true,
  } = options;
  const endKeysKey = endKeys?.join('\u0000');

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const detector = createScanDetector({ minLength, maxIntervalMs, endKeys: endKeysKey?.split('\u0000') });
    const handler = (event: KeyboardEvent): void => {
      if (!allowInInputs && isEditableTarget(event.target)) {
        detector.reset();
        return;
      }
      const code = detector.feed(event);
      if (code === null) return;
      if (preventEndKeyDefault) event.preventDefault();
      onScanRef.current(code);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, minLength, maxIntervalMs, endKeysKey, allowInInputs, preventEndKeyDefault]);
}
