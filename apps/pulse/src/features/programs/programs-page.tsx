import { notFound } from 'next/navigation';
import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import type { ProgramListDTO } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import type { ClientDTO } from '@/lib/types';
import { getProgramsAvailability, getSettings, listClients, listTrackedPrograms, todayInZone } from '@/server/domain';
import { pulsePage } from '@/server/page';
import { ProgramsMonthPicker, ProgramsView } from './programs-view';

const MONTH_RE = /^\d{4}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** A read that failed leaves the client to load it again (and show the retry state if that fails too). */
async function soft<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch {
    return undefined;
  }
}

/**
 * Programs (docs/programs/PULSE_PROGRAMS_SPEC.md 7.2): every program Pulse tracks with this
 * month's numbers, plan, forecast and health, and the programs in Projects not tracked yet.
 * Hidden where the program tracker is not available.
 */
export async function ProgramsPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const asked = first(query.month);
  const month = MONTH_RE.test(asked) ? asked : '';
  const page = await pulsePage(routes.programs({ month: month || undefined }), 'programs');
  if (page.blocked) return <PageBlocked title="Programs" role={page.access.role} />;
  const availability = await soft(getProgramsAvailability(page.ctx));
  if (availability && !availability.available) notFound();
  const [list, settings] = await Promise.all([soft<ProgramListDTO>(listTrackedPrograms(page.ctx, { month: month || null })), soft(getSettings(page.ctx))]);
  const currentMonth = todayInZone(settings?.timezone ?? 'UTC').slice(0, 7);
  // The client picker of "Track in Pulse" is only needed when a program has no matched client.
  const needsClients = Boolean(list?.canTrack && list.notTracked.some((program) => !program.matchedClient));
  const clients = needsClients ? await soft<ClientDTO[]>(listClients(page.ctx, {})) : undefined;
  return (
    <Page title="Programs" subtitle="Recurring work under one price card: kits, revenue and margin by month, with the plan and forecast from Projects." width="full" actions={<ProgramsMonthPicker currentMonth={currentMonth} />}>
      <ProgramsView initialList={list} initialMonth={month} currentMonth={currentMonth} clients={clients ?? []} />
    </Page>
  );
}
