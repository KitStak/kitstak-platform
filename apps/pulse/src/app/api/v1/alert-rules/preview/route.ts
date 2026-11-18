import { apiRoute } from '@/server/http/api';
import { oneOf, str, uuidParam } from '@/server/http/params';
import { previewAlertRule } from '@/server/domain';
import { invalid } from '@/server/errors';
import { ALERT_KINDS } from '@/lib/constants';

/** What a rule would have said in the last 30 days. `?kind=&threshold=&client=&jobType=&site=&rule=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  const kind = oneOf(searchParams, 'kind', ALERT_KINDS);
  if (!kind) throw invalid('Pick what the rule watches.');
  const threshold = str(searchParams, 'threshold');
  if (threshold !== null && !/^-?\d{1,12}(\.\d{1,4})?$/.test(threshold)) throw invalid('Type a number for the rule.', { threshold: 'Type a number.' });
  return previewAlertRule(ctx, { kind, threshold, scope: { clientId: uuidParam(searchParams, 'client'), jobTypeId: uuidParam(searchParams, 'jobType'), siteId: uuidParam(searchParams, 'site') }, ruleId: uuidParam(searchParams, 'rule') });
});
