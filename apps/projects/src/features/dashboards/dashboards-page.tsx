import { getPortfolioReport, getProjectReport, listProjects } from '@/server/domain';
import { isDomainError } from '@/server/errors';
import { pageContext } from '@/server/page';
import { listPrograms, listVariants, programTrends } from '@/server/domain/programs';
import { quantityToScaled } from '@kitstak/programs-engine';
import type { DomainContext } from '@/server/domain/_shared';
import { last12 } from '@/features/programs/trends/trends-model';
import { DashboardsView, type DashboardsFilters } from './dashboards-view';
import type { ProgramsDashboardData } from './program-panels';

/** The Programs section (docs/programs/SPEC.md 5.19). Empty when there are no programs or they cannot be read. */
async function loadPrograms(ctx: DomainContext): Promise<ProgramsDashboardData | null> {
  try {
    const programs = (await listPrograms(ctx)).filter((program) => program.status === 'active' || program.status === 'on_hold');
    if (programs.length === 0) return null;
    const month = programs[0]!.month.month;
    const range = last12(month);
    const [trends, variantLists] = await Promise.all([programTrends(ctx, { from: range.from, to: range.to, groupBy: 'program' }), Promise.all(programs.map((program) => listVariants(ctx, program.key).catch(() => [])))]);
    const rowById = new Map(trends.rows.map((row) => [row.id, row]));
    const variants = programs
      .flatMap((program, index) => (variantLists[index] ?? []).map((variant) => ({ programKey: program.key, name: variant.name, color: variant.color, units: variant.monthUnits, unit: program.unit, revenueCents: variant.monthRevenueCents })))
      .filter((variant) => quantityToScaled(variant.units || '0') > BigInt(0))
      .sort((a, b) => {
        const diff = quantityToScaled(b.units) - quantityToScaled(a.units);
        return diff > BigInt(0) ? 1 : diff < BigInt(0) ? -1 : a.name.localeCompare(b.name);
      })
      .slice(0, 10);
    return {
      months: trends.months,
      month,
      moneyHidden: programs.some((program) => program.moneyHidden),
      programs: programs.map((program) => {
        const row = rowById.get(program.id);
        return {
          id: program.id,
          key: program.key,
          name: program.name,
          color: program.color,
          icon: program.icon,
          unit: program.unit,
          cells: trends.months.map((entry) => {
            const cell = row?.cells.find((c) => c.month === entry);
            return { month: entry, units: cell?.units ?? '0', revenueCents: program.moneyHidden ? null : (cell?.revenueCents ?? '0') };
          }),
          forecastCents: program.month.forecastCents,
          targetCents: program.month.targetCents,
          targetBp: program.month.targetBp,
        };
      }),
      variants,
    };
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function DashboardsPage({ project, space, weeks }: { readonly project?: string; readonly space?: string; readonly weeks?: string }) {
  const { ctx } = await pageContext('/dashboards');
  const parsedWeeks = Number(weeks);
  const filters: DashboardsFilters = {
    project: project ? project.toUpperCase() : undefined,
    space: space && UUID.test(space) ? space : undefined,
    weeks: [4, 8, 12].includes(parsedWeeks) ? parsedWeeks : 8,
  };
  const [projects, programs] = await Promise.all([listProjects(ctx), filters.project ? Promise.resolve(null) : loadPrograms(ctx)]);
  const report = await (filters.project
    ? getProjectReport(ctx, { key: filters.project }, { weeks: filters.weeks })
    : getPortfolioReport(ctx, { weeks: filters.weeks, spaceId: filters.space ?? null })
  ).catch((error: unknown) => {
    if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return null;
    throw error;
  });
  return <DashboardsView programs={programs} initialReport={report} initialProjects={projects} initialFilters={report || !filters.project ? filters : { ...filters, project: undefined }} />;
}
