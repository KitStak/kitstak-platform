/**
 * Count status pill (M07): the shared StatusPill on the count domain. The count map itself keeps
 * the lifecycle apart: Count completed is info (counted, waiting for Update Inv.), Inventory
 * updated positive (posted), Recount created neutral (superseded).
 */
import { StatusPill } from '@/components/ui/status-pill';
import { statusTone, type StatusDomain, type StatusTone } from '@/lib/status-colors';

/** Count tone for a status (kept for the status chips, which draw a matching dot). */
export function countToneOf(status: string, domain: StatusDomain = 'count'): StatusTone {
  return statusTone(status, domain);
}

export function CountStatusPill({
  status,
  domain = 'count',
  className,
}: {
  readonly status: string;
  readonly domain?: StatusDomain;
  /** @deprecated Pills have one size; kept so existing call sites compile. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  return <StatusPill status={status} domain={domain} className={className} />;
}
