'use client';
/**
 * Type-ahead for keyboard-opened inputs. Pressing `c` (quick add) or Ctrl/Cmd+K (palette) and
 * typing right away must not lose the first letters, and must never let them fall through to
 * page shortcuts (in the task drawer, `i` assigns and `t` sets a due date). From the key press
 * that opens the surface until its input has focus, printable keys are caught on `window` in the
 * capture phase, then typed into the input once it mounts.
 */

const MAX_WAIT_MS = 4000;

type TextInput = HTMLInputElement | HTMLTextAreaElement;

let active: (() => void) | null = null;

function insert(input: TextInput, text: string): void {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const next = input.value.slice(0, start) + text + input.value.slice(end);
  // React tracks the value: go through the native setter so onChange sees the new text.
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
}

/** Catch what is typed until `selector` matches a focusable input, then hand it over. */
export function catchTypeAhead(selector: string, alreadyTyped = ''): void {
  active?.();
  let buffer = alreadyTyped;
  let frame = 0;
  const started = Date.now();
  const find = (): TextInput | null => {
    const element = document.querySelector(selector);
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  };
  const onKey = (event: KeyboardEvent) => {
    const input = find();
    if (input && document.activeElement === input) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    buffer += event.key;
  };
  const stop = () => {
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(frame);
    if (active === stop) active = null;
  };
  const tick = () => {
    const input = find();
    if (input) {
      if (document.activeElement !== input) input.focus({ preventScroll: true });
      if (buffer) insert(input, buffer);
      stop();
      return;
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      stop();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  window.addEventListener('keydown', onKey, true);
  active = stop;
  frame = requestAnimationFrame(tick);
}

export const QUICK_ADD_INPUT = '[data-testid="quick-add-title"]';
export const PALETTE_INPUT = '[cmdk-input]';
