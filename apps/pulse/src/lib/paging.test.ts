import { describe, expect, it } from 'vitest';
import { collectPages, type Page } from './paging';

/** A server holding `total` numbers that answers `limit` at a time, like `GET /api/v1/profit/facts`. */
function server(total: number, limit: number) {
  const calls: number[] = [];
  const fetchPage = async (offset: number): Promise<Page<number>> => {
    calls.push(offset);
    const data = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => offset + index + 1);
    const truncated = offset + limit < total;
    return { data, meta: { truncated, limit, offset, nextOffset: truncated ? offset + limit : null } };
  };
  return { calls, fetchPage };
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

describe('collectPages', () => {
  it('reads every page, so a total is the whole total', async () => {
    const { calls, fetchPage } = server(1234, 500);
    const all = await collectPages(fetchPage);
    expect(all.truncated).toBe(false);
    expect(all.rows).toHaveLength(1234);
    expect(sum(all.rows)).toBe((1234 * 1235) / 2);
    expect(calls).toEqual([0, 500, 1000]);
  });

  it('asks once when the first page is the whole list', async () => {
    const { calls, fetchPage } = server(500, 500);
    expect(await collectPages(fetchPage)).toMatchObject({ truncated: false });
    expect(calls).toEqual([0]);
  });

  it('says the list is cut when it stops at the most rows it may read', async () => {
    const { calls, fetchPage } = server(5000, 500);
    const all = await collectPages(fetchPage, { maxRows: 1000 });
    expect(all).toMatchObject({ truncated: true });
    expect(all.rows).toHaveLength(1000);
    expect(calls).toEqual([0, 500]);
  });

  it('treats an answer with no paging facts as the last page', async () => {
    expect(await collectPages(async () => ({ data: [1, 2, 3] }))).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  it('never loops when the next offset does not move forward', async () => {
    let calls = 0;
    const all = await collectPages(async () => {
      calls += 1;
      return { data: [1], meta: { truncated: true, limit: 1, offset: 0, nextOffset: 0 } };
    });
    expect(calls).toBe(1);
    expect(all).toEqual({ rows: [1], truncated: true });
  });
});
