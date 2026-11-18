/**
 * Reading a paged list to the end. Routes that can hold more rows than one answer send
 * `meta { truncated, limit, offset, nextOffset }` next to `data`. Anything that adds the rows up
 * has to read every page, or say that the list is cut: a total over the first page alone is wrong.
 */
export interface PageMeta {
  readonly truncated: boolean;
  readonly limit: number;
  readonly offset: number;
  /** The `offset` of the next page, or null on the last page. */
  readonly nextOffset: number | null;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly meta?: Partial<PageMeta> | null;
}

export interface AllRows<T> {
  readonly rows: T[];
  /** True when reading stopped at `maxRows` with more rows still waiting. Show that the list is cut. */
  readonly truncated: boolean;
}

/** The most rows a screen reads before it stops and says the list is cut. */
export const ALL_ROWS_MAX = 100_000;

/**
 * Reads page after page until the server says there is no next one, or until `maxRows` rows are
 * in hand. A page with no `meta` counts as the last one. A next offset that does not move
 * forward stops the read, so a wrong answer can never loop.
 */
export async function collectPages<T>(fetchPage: (offset: number) => Promise<Page<T>>, options: { maxRows?: number } = {}): Promise<AllRows<T>> {
  const maxRows = Math.max(1, options.maxRows ?? ALL_ROWS_MAX);
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset);
    rows.push(...page.data);
    const next = page.meta?.truncated ? (page.meta.nextOffset ?? null) : null;
    if (next === null) return { rows, truncated: false };
    if (rows.length >= maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    if (next <= offset || page.data.length === 0) return { rows, truncated: true };
    offset = next;
  }
}
