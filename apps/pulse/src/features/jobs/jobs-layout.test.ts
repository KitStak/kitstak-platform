/**
 * The Jobs table at tablet and small laptop widths: cards up to lg, and on the table the money
 * and due columns stay on screen while client and trend wait for xl.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/charts/charts.css', () => ({}));

import { columnCellClass, JOB_COLUMNS } from './jobs-columns';

const col = (id: string) => JOB_COLUMNS.find((column) => column.id === id)!;

describe('jobs table layout', () => {
  it('client and trend fold away below xl; client shows under the job name instead', () => {
    expect(columnCellClass(col('client'))).toContain('hidden xl:table-cell');
    expect(columnCellClass(col('trend'))).toContain('hidden xl:table-cell');
  });

  it('margin now, profit at finish and due always show on the table', () => {
    for (const id of ['margin', 'projProfit', 'due']) expect(columnCellClass(col(id))).not.toContain('hidden');
  });

  it('the reason text gets a tighter column below xl', () => {
    expect(columnCellClass(col('risk'))).toMatch(/min-w-\[200px\]/);
    expect(columnCellClass(col('risk'))).toMatch(/xl:min-w-\[260px\]/);
  });
});
