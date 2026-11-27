import { apiRoute } from '@/server/http/api';
import { listProjectActivity } from '@/server/domain';
import { requireProgram } from '@/server/domain/programs';

const FILTERS: Readonly<Record<string, readonly string[] | undefined>> = {
  money: ['price_card.version_published', 'price_card.unpublished', 'price_card.version_replaced', 'price_card.variant_rate_changed', 'one_time.added', 'one_time.updated', 'one_time.deleted', 'program.month_closed', 'program.month_reopened', 'build.rate_override_set', 'build.repriced'],
  output: ['build.output_logged', 'build.output_deleted', 'build.closed_short', 'build.split', 'run.closed'],
  plan: ['schedule.created', 'schedule.updated', 'schedule.paused', 'schedule.resumed', 'schedule.ended', 'schedule.generated', 'build.planned', 'run.moved', 'run.copied', 'run.cancelled'],
  setup: ['program.created', 'program.updated', 'program.settings_changed', 'program.status_changed', 'variant.created', 'variant.updated', 'variant.retired', 'variant.restored', 'variant.deleted', 'attributes.changed', 'link.added', 'link.removed', 'program.pulse_job_linked', 'program.pulse_job_unlinked'],
};

/** GET /api/v1/programs/:key/activity?cursor=&filter= (money stripped per 4.10). */
export const GET = apiRoute<{ key: string }>(async ({ ctx, params, searchParams }) => {
  const { program } = await requireProgram(ctx, decodeURIComponent(params.key));
  const filter = searchParams.get('filter') ?? 'all';
  return listProjectActivity(ctx, program.id, { before: searchParams.get('cursor') ?? undefined, verbs: FILTERS[filter] });
});
