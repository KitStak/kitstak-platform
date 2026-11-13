/**
 * Plain-language colour for a sibling-app status label ("Proposal", "Shipped", "On Hold"),
 * so CRM stages and WMS statuses read the same everywhere in Projects. Pure; unit tested.
 */
import type { LabelColor } from '@/components/ui';
import type { IntegrationTargetType } from '@/lib/constants';

export type StatusTone = 'success' | 'danger' | 'warning' | 'progress' | 'neutral';

const RULES: readonly (readonly [RegExp, StatusTone])[] = [
  [/\b(won|closed won|shipped|delivered|completed?|done|received|closed|active|approved|signed|paid|live)\b/i, 'success'],
  [/\b(lost|closed lost|cancel+ed|void|rejected|disqualified|dead|churned|failed|inactive)\b/i, 'danger'],
  [/\b(on hold|hold|shortage|blocked|overdue|at risk|stuck|past due|exception|backorder(ed)?)\b/i, 'warning'],
  [/\b(started|in process|in progress|picking|packing|sorting|loading|ready|negotiation|proposal|discovery|qualified|counting|partially|open)\b/i, 'progress'],
];

export function statusTone(status: string | null | undefined): StatusTone {
  const value = (status ?? '').trim();
  if (!value) return 'neutral';
  for (const [pattern, tone] of RULES) if (pattern.test(value)) return tone;
  return 'neutral';
}

export const TONE_COLOR: Readonly<Record<StatusTone, LabelColor>> = {
  success: 'green',
  danger: 'red',
  warning: 'orange',
  progress: 'blue',
  neutral: 'gray',
};

/** Which sibling app a link points into (core customers belong to the shared registry, shown as CRM). */
export function targetApp(type: IntegrationTargetType): 'crm' | 'wms' {
  return type.startsWith('wms_') ? 'wms' : 'crm';
}
