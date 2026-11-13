import {
  describeAutomationRule,
  listAutomations,
  listProjects,
  listRecentAutomationRuns,
} from '@/server/domain';
import { scheduleAutomationSweep } from '@/server/domain/automation-sweep';
import { pageContext } from '@/server/page';
import { AutomationsView } from './automations-view';

export async function AutomationsPage() {
  const { ctx } = await pageContext('/automations');
  // Due-date and CRM/WMS triggers are checked after this page is sent (throttled per workspace).
  scheduleAutomationSweep(ctx);
  const [rules, projects, runs] = await Promise.all([
    listAutomations(ctx),
    listProjects(ctx),
    listRecentAutomationRuns(ctx, { limit: 150 }),
  ]);
  const withSentences = await Promise.all(
    rules.map(async (rule) => ({ ...rule, sentence: await describeAutomationRule(ctx, rule) })),
  );
  return <AutomationsView rules={withSentences} projects={projects} initialRuns={runs} />;
}
