import { notFound } from 'next/navigation';
import { Repeat2 } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PageBlocked } from '@/features/access/page-blocked';
import type { ProgramDaysDTO, ProgramLaborDTO, ProgramMonthDTO, ProgramMonthsDTO, ProgramVariantsDTO } from '@/lib/program-types';
import { PROGRAM_TABS, routes, type ProgramTab } from '@/lib/routes';
import { getProgramDays, getProgramLabor, getProgramMonth, getProgramMonths, getProgramsAvailability, getProgramVariants, listTrackedPrograms, todayInZone } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pulsePage } from '@/server/page';
import { ProgramFrame } from './program-frame';

const MONTH_RE = /^\d{4}-\d{2}$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function parseProgramTab(value: string | string[] | undefined): ProgramTab {
  const raw = first(value);
  return (PROGRAM_TABS as readonly string[]).includes(raw) ? (raw as ProgramTab) : 'overview';
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
 * One program (docs/programs/PULSE_PROGRAMS_SPEC.md 7.3): the header and the five tabs. The
 * Overview read always comes along (it carries the header); the open tab is read here too, so
 * the first paint has its numbers. Switching tabs or months happens on the client.
 */
export async function ProgramPage({ params, searchParams }: { readonly params: Promise<{ key: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const key = decodeURIComponent((await params).key);
  const query = await searchParams;
  const tab = parseProgramTab(query.tab);
  const asked = first(query.month);
  const month = MONTH_RE.test(asked) ? asked : '';
  const page = await pulsePage(routes.program(key, { month: month || undefined, tab }), 'programs');
  if (page.blocked) return <PageBlocked title="Program" role={page.access.role} />;
  const availability = await soft(getProgramsAvailability(page.ctx));
  if (availability && !availability.available) notFound();

  let overview: ProgramMonthDTO | undefined;
  try {
    overview = await getProgramMonth(page.ctx, key, month || null);
  } catch (error) {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION')) {
      // A program that runs in Projects and has no Pulse job yet (the Profit page links those too).
      const list = await soft(listTrackedPrograms(page.ctx, {}));
      const untracked = list?.notTracked.find((program) => program.key.toUpperCase() === key.toUpperCase());
      if (untracked) {
        return (
          <Page title={untracked.name} breadcrumbs={[{ label: 'Programs', href: routes.programs() }, { label: untracked.key }]}>
            <Panel>
              <Teach
                testId="program-not-tracked"
                icon={Repeat2}
                title={`${untracked.key} is not tracked in Pulse yet`}
                why="This program runs in Projects. Track it in Pulse to see its labor, cost and margin by month and by variant. Its builds already count on the jobs they bill to."
                actions={<ButtonLink href={`${routes.programs()}#not-tracked`}>{list?.canTrack ? 'Track it in Pulse' : 'See all programs'}</ButtonLink>}
              />
            </Panel>
          </Page>
        );
      }
      return (
        <Page title="Program not found" breadcrumbs={[{ label: 'Programs', href: routes.programs() }, { label: key }]}>
          <Panel>
            <Teach
              testId="program-not-found"
              icon={Repeat2}
              title="We could not find that program"
              why={`No program with the key ${key} is tracked in ${page.context.org.name}. It may not be tracked in Pulse yet, or the link may belong to another workspace.`}
              actions={<ButtonLink href={routes.programs()}>See all programs</ButtonLink>}
            />
          </Panel>
        </Page>
      );
    }
    overview = undefined;
  }
  const shownMonth = overview?.month.month ?? month;
  const [variants, months, days, labor] = await Promise.all([
    tab === 'variants' ? soft<ProgramVariantsDTO>(getProgramVariants(page.ctx, key, shownMonth || null)) : undefined,
    tab === 'months' ? soft<ProgramMonthsDTO>(getProgramMonths(page.ctx, key, {})) : undefined,
    tab === 'days' ? soft<ProgramDaysDTO>(getProgramDays(page.ctx, key, shownMonth || null)) : undefined,
    tab === 'labor' ? soft<ProgramLaborDTO>(getProgramLabor(page.ctx, key, shownMonth || null)) : undefined,
  ]);
  const currentMonth = todayInZone(overview?.header.timezone ?? 'UTC').slice(0, 7);
  return <ProgramFrame programKey={key} initialTab={tab} initialMonth={shownMonth || currentMonth} currentMonth={currentMonth} initial={{ overview, variants, months, days, labor }} />;
}
