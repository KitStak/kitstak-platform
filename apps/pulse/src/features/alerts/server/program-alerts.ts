/**
 * Program alerts for the Alerts page (PULSE_PROGRAMS_SPEC 6): the tracked programs of this month,
 * and for each one whose health dot says something is wrong, every alert that fires. Programs
 * that are on track are not read again. Fail soft: a program that cannot be read is left out.
 */
import 'server-only';
import { scoped } from '@/server/db/scope';
import { getProgramMonth, listTrackedPrograms, type DomainContext } from '@/server/domain';
import { logSoftFail } from '@/server/integrations/log';
import { sortProgramAlertGroups, type ProgramAlertGroupDTO, type ProgramAlertsDTO } from '../program-alerts';

export const listProgramAlerts = scoped(async function listProgramAlerts(ctx: DomainContext): Promise<ProgramAlertsDTO> {
  const list = await listTrackedPrograms(ctx, {});
  if (!list.available) return { month: list.month, groups: [] };
  const flagged = list.programs.filter((program) => !program.deleted && program.healthReason !== null);
  const groups = await Promise.all(
    flagged.map(async (program): Promise<ProgramAlertGroupDTO | null> => {
      try {
        const month = await getProgramMonth(ctx, program.key, list.month);
        return { key: program.key, name: program.name, health: month.health, path: program.path, projectsPath: program.projectsPath, alerts: month.alerts };
      } catch (error) {
        logSoftFail(ctx.orgId, 'alerts.listProgramAlerts', error);
        return null;
      }
    }),
  );
  return { month: list.month, groups: sortProgramAlertGroups(groups.filter((group): group is ProgramAlertGroupDTO => group !== null)) };
});
