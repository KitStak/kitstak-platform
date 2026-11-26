'use client';
/**
 * "Programs this month" on Home (docs/programs/PULSE_PROGRAMS_SPEC.md 5.4): the top 5 tracked
 * programs by revenue, each with its revenue, margin against the customer's target and a health
 * dot. Shown only when the org tracks a program. A reader who cannot see money gets kits against
 * planned instead.
 */
import { ActionList, ActionRow, DashSection, type PillTone } from '@kitstak/ui/dashboard';
import { formatMoney, formatPercentBp } from '@/lib/format';
import type { ProgramHealth, ProgramListDTO, ProgramListRowDTO } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { HEALTH_LABELS, marginTone, monthLabel, toneText } from '@/features/programs/program-format';
import { useProgramList } from '@/features/programs/use-programs';
import { useShell } from '@/features/shell/shell-context';

const MARKER: Readonly<Record<ProgramHealth, PillTone>> = { on_track: 'positive', heads_up: 'info', at_risk: 'caution', losing: 'critical', no_data: 'neutral' };
const HOME_PROGRAMS = 5;

const count = (value: string | null): string => (value === null ? '' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 }));

/** The programs the card shows: most revenue first (most units for a reader without money). */
export function topPrograms(list: ProgramListDTO): ProgramListRowDTO[] {
  const money = !list.moneyHidden;
  return [...list.programs].sort((a, b) => (money ? (b.revenueCents ?? 0) - (a.revenueCents ?? 0) : Number(b.units) - Number(a.units))).slice(0, HOME_PROGRAMS);
}

export function HomeProgramsCard({ initial }: { readonly initial?: ProgramListDTO }) {
  const { programs: available } = useShell();
  const query = useProgramList('', { initialData: initial, enabled: Boolean(available) });
  const list = query.data;
  if (!available || !list || list.programs.length === 0) return null;
  const money = !list.moneyHidden;
  const rows = topPrograms(list);
  return (
    <DashSection title="Programs this month" description={`${monthLabel(list.month)}, month to date`} action={{ label: list.programs.length > rows.length ? `All ${list.programs.length} programs` : 'All programs', href: routes.programs() }} flush data-testid="home-programs">
      <ActionList label="Programs this month">
        {rows.map((row) => (
          <ActionRow
            key={row.programId}
            href={routes.program(row.key)}
            marker={MARKER[row.health]}
            tag={row.key}
            title={
              <>
                <span className="sr-only">{HEALTH_LABELS[row.health]}: </span>
                {row.name}
              </>
            }
            reason={row.healthReason ?? `${count(row.units)} of ${count(row.plannedUnits)} ${row.unit.plural} planned`}
            value={money ? formatMoney(row.revenueCents, { cents: false }) : `${count(row.units)} ${row.unit.plural}`}
            valueTone={money && (row.profitCents ?? 0) < 0 ? 'critical' : 'neutral'}
            valueCaption={
              money && row.marginBp !== null ? (
                <span>
                  <span className={`font-medium ${toneText(marginTone(row.marginBp, row.targetMarginBp))}`}>{formatPercentBp(row.marginBp)}</span>
                  {row.targetMarginBp !== null ? ` of ${formatPercentBp(row.targetMarginBp, { digits: 0 })} target` : ' margin'}
                </span>
              ) : money ? (
                'No revenue yet'
              ) : (
                `of ${count(row.plannedUnits)} planned`
              )
            }
            shape="value"
            data-testid="home-program-row"
          />
        ))}
      </ActionList>
    </DashSection>
  );
}
