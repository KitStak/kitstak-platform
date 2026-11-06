'use client';

/**
 * Highlights search matches inside the board canvas with the CSS Custom Highlight API
 * (`::highlight(ks-board-search)`), so the table, kanban cards and grouped rows all light up
 * without owning their markup. Re-applied as virtualized rows mount (MutationObserver + rAF).
 * Silently no-ops where the API is unavailable.
 */
import { useEffect, type RefObject } from 'react';

const HIGHLIGHT = 'ks-board-search';
const SKIP = new Set(['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'SVG']);
const MAX_RANGES = 2_000;

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): { readonly map: HighlightRegistry; readonly Highlight: new (...ranges: Range[]) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return css?.highlights && Ctor ? { map: css.highlights, Highlight: Ctor } : null;
}

export function collectRanges(root: Node, needle: string, limit = MAX_RANGES): Range[] {
  const ranges: Range[] = [];
  if (!needle) return ranges;
  const lower = needle.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName.toUpperCase()) || parent.closest('[data-no-highlight]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    const text = (node.textContent ?? '').toLowerCase();
    let index = text.indexOf(lower);
    while (index !== -1 && ranges.length < limit) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + lower.length);
      ranges.push(range);
      index = text.indexOf(lower, index + lower.length);
    }
  }
  return ranges;
}

export function useSearchHighlight(rootRef: RefObject<HTMLElement | null>, query: string): void {
  useEffect(() => {
    const api = registry();
    const root = rootRef.current;
    const needle = query.trim();
    if (!api || !root || needle.length < 1) {
      api?.map.delete(HIGHLIGHT);
      return;
    }
    let frame = 0;
    const apply = () => {
      frame = 0;
      api.map.set(HIGHLIGHT, new api.Highlight(...collectRanges(root, needle)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      api.map.delete(HIGHLIGHT);
    };
  }, [query, rootRef]);
}
