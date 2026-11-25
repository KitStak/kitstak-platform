'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SearchEntry } from '@/lib/docs/docs';
import styles from './docs.module.css';

function score(entry: SearchEntry, terms: readonly string[]): number {
  const title = entry.t.toLowerCase();
  const desc = entry.d.toLowerCase();
  const heads = entry.h.join(' ').toLowerCase();
  const where = `${entry.a} ${entry.s}`.toLowerCase();
  let total = 0;
  for (const term of terms) {
    const hit =
      (title.includes(term) ? 8 : 0) +
      (heads.includes(term) ? 3 : 0) +
      (desc.includes(term) ? 2 : 0) +
      (where.includes(term) ? 1 : 0);
    if (hit === 0) return 0;
    total += hit + (title.startsWith(term) ? 4 : 0);
  }
  return total;
}

/**
 * The docs search box. The index (/docs/search-index.json) loads on first focus, so a page that is
 * only read never downloads it. Arrow keys move through results; Enter opens one.
 */
export function DocsSearch({
  autoFocus = false,
  large = false,
}: {
  readonly autoFocus?: boolean;
  readonly large?: boolean;
}) {
  const [index, setIndex] = useState<readonly SearchEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const loading = useRef(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (index || loading.current) return;
    loading.current = true;
    fetch('/docs/search-index.json')
      .then((r) => (r.ok ? (r.json() as Promise<SearchEntry[]>) : []))
      .then(setIndex)
      .catch(() => setIndex([]))
      .finally(() => {
        loading.current = false;
      });
  }, [index]);

  useEffect(() => {
    if (autoFocus) load();
  }, [autoFocus, load]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const results = useMemo(() => {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    if (!index || terms.length === 0) return [];
    return index
      .map((entry) => ({ entry, rank: score(entry, terms) }))
      .filter((r) => r.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 8)
      .map((r) => r.entry);
  }, [index, query]);

  const show = open && query.trim().length > 1;

  return (
    <div ref={box} className={`${styles.search} ${large ? styles.searchLarge : ''}`}>
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        Search the docs
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        placeholder="Search the docs"
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && results[active] ? `${listId}-${active}` : undefined}
        value={query}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            window.location.assign(results[active].u);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {show ? (
        <ul id={listId} role="listbox" className={styles.results}>
          {results.length === 0 ? (
            <li className={styles.noResults}>{index ? 'No pages match. Try fewer words.' : 'Loading…'}</li>
          ) : (
            results.map((r, i) => (
              <li key={r.u} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <Link
                  href={r.u}
                  className={styles.result}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                >
                  <span className={styles.resultWhere}>
                    {r.a} / {r.s}
                  </span>
                  <span className={styles.resultTitle}>{r.t}</span>
                  <span className={styles.resultDesc}>{r.d}</span>
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
