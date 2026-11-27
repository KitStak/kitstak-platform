import { pulseAccessFor } from '@/server/domain';
import { notFound } from '@/server/errors';
import { csvResponse } from '@/server/http/api';
import { fileRoute } from '@/features/reports/server/file-route';
import { zipResponse } from '@/features/export/server/zip-response';
import { howToFillCsv, templateCsv } from '@/lib/csv/template';
import { STREAMS, streamInfo } from '@/lib/streams';

/**
 * Template downloads for the import center:
 *   `/api/v1/templates/production.csv`           header row and two example rows
 *   `/api/v1/templates/production-how-to.csv`    each column, whether it is needed, allowed values
 *   `/api/v1/templates/job_plans-lines.csv`      the line by line layout of quotes and budgets
 *   `/api/v1/templates/all.zip`                  every template and its how to file
 * Money and wage columns are left out for people who cannot see them.
 */
export const GET = fileRoute<{ file: string }>(async ({ ctx, params }) => {
  const access = await pulseAccessFor(ctx);
  if (access.role === 'none') throw notFound('That template');
  const filter = { canSeeMoney: access.seesMoney, canSeeWages: access.seesWages };
  const file = decodeURIComponent(params.file);
  if (file === 'all.zip') {
    const entries = STREAMS.flatMap((stream) => {
      const base = stream.file.replace(/\.csv$/, '');
      const list = [
        { name: stream.file, content: templateCsv(stream.id, filter) },
        { name: `how-to-fill/${base}-how-to.csv`, content: howToFillCsv(stream.id, filter) },
      ];
      if (stream.id === 'job_plans') list.push({ name: `${base}-lines.csv`, content: templateCsv(stream.id, { ...filter, layout: 'lines' }) });
      return list;
    });
    return zipResponse('pulse-templates.zip', entries);
  }
  const match = /^([a-z_]+?)(-how-to|-lines)?\.csv$/.exec(file);
  const info = match ? (streamInfo(match[1] as string) ?? STREAMS.find((stream) => stream.file === `${match[1]}.csv`) ?? null) : null;
  if (!match || !info) throw notFound('That template');
  const base = info.file.replace(/\.csv$/, '');
  if (match[2] === '-how-to') return csvResponse(`${base}-how-to.csv`, howToFillCsv(info.id, filter));
  if (match[2] === '-lines' && info.id === 'job_plans') return csvResponse(`${base}-lines.csv`, templateCsv(info.id, { ...filter, layout: 'lines' }));
  if (match[2] === '-lines') throw notFound('That template');
  return csvResponse(info.file, templateCsv(info.id, filter));
});
