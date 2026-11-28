/**
 * The people export (docs/crew/SPEC.md section 7 and 6.1 `/export`): the People file in its
 * template columns, so an export imported again changes nothing. Needs `export:run`. Pay columns
 * are dropped for a reader without pay rights and emergency columns without private rights (3.3:
 * exports drop the columns). The badge column is always empty: Crew keeps only a hash.
 */
import 'server-only';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { exportFileName, toCsv } from '@/lib/csv/write';
import { peopleColumnsFor } from '@/lib/csv/people';
import { requireCrew } from './access';
import { todayInZone, type DomainContext } from './_shared';
import { listPersonRecords, sightOf, type PeopleFilters } from './people';
import { loadPeopleFile } from './people-file';

export interface CsvFile {
  readonly fileName: string;
  readonly csv: string;
  readonly rows: number;
}

export const exportPeopleCsv = scoped(async function exportPeopleCsv(ctx: DomainContext, filters: PeopleFilters = {}): Promise<CsvFile> {
  const access = await requireCrew(ctx, 'export:run');
  const sight = sightOf(access);
  const columns = peopleColumnsFor(sight);
  // The reader's scope and filters pick the people; the file view gives their template values.
  const visible = new Set((await listPersonRecords(ctx, access, { ...filters, limit: 5000 })).map((record) => record.id));
  const file = (await loadPeopleFile(db, ctx.orgId)).filter((row) => visible.has(row.id));
  const csv = toCsv(
    columns.map((column) => column.key),
    file.map((row) => columns.map((column) => row.cells[column.key])),
  );
  const today = todayInZone('UTC');
  return { fileName: exportFileName('people', ctx.orgSlug, today, today), csv, rows: file.length };
});
