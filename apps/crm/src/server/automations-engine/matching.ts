/** Pure trigger matching and condition evaluation. */
import type { ItemEvent } from '@/server/services/item-events';
import type { AutomationConditionRecipe, AutomationTriggerRecipe } from './recipes';

function labelOf(value: unknown): string | null {
  const labelId = (value as { labelId?: unknown } | null | undefined)?.labelId;
  return typeof labelId === 'string' ? labelId : null;
}

function peopleOf(value: unknown): string[] {
  const ids = (value as { ids?: unknown } | null | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** Does `event` fire `trigger`? */
export function triggerMatches(trigger: AutomationTriggerRecipe, event: ItemEvent): boolean {
  switch (trigger.type) {
    case 'item_created':
      return event.type === 'item_created';
    case 'status_changed': {
      if (event.type !== 'column_changed' || event.columnKey !== trigger.config.columnKey) return false;
      const to = labelOf(event.after);
      const from = labelOf(event.before);
      if (to === from) return false;
      if (trigger.config.toLabelId && to !== trigger.config.toLabelId) return false;
      if (trigger.config.fromLabelId && from !== trigger.config.fromLabelId) return false;
      return true;
    }
    case 'column_changed':
      return event.type === 'column_changed' && event.columnKey === trigger.config.columnKey;
    case 'person_assigned': {
      if (event.type !== 'column_changed' || event.columnKey !== trigger.config.columnKey) return false;
      const before = peopleOf(event.before);
      const added = peopleOf(event.after).filter((id) => !before.includes(id));
      if (added.length === 0) return false;
      return trigger.config.userId ? added.includes(trigger.config.userId) : true;
    }
    case 'date_arrived':
      return event.type === 'date_arrived' && event.columnKey === trigger.config.columnKey;
    case 'item_moved_to_group':
      return event.type === 'item_moved' && event.toGroupId === trigger.config.groupId;
  }
}

export interface ConditionSubject {
  readonly groupId: string;
  readonly values: Record<string, unknown>;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'object') {
    for (const key of ['ids', 'labelIds', 'itemIds', 'fileIds', 'tags']) {
      const list = (value as Record<string, unknown>)[key];
      if (Array.isArray(list)) return list.length === 0;
    }
  }
  return false;
}

function numericOf(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const amount = (value as { amount?: unknown } | null | undefined)?.amount;
  return typeof amount === 'number' ? amount : null;
}

export function conditionHolds(condition: AutomationConditionRecipe, subject: ConditionSubject): boolean {
  switch (condition.type) {
    case 'status_is': {
      const label = labelOf(subject.values[condition.config.columnKey]) ?? 'default';
      return condition.config.labelIds.includes(label);
    }
    case 'column_is_empty':
      return isEmpty(subject.values[condition.config.columnKey]);
    case 'column_not_empty':
      return !isEmpty(subject.values[condition.config.columnKey]);
    case 'in_group':
      return subject.groupId === condition.config.groupId;
    case 'person_is':
      return peopleOf(subject.values[condition.config.columnKey]).includes(condition.config.userId);
    case 'number_compare': {
      const value = numericOf(subject.values[condition.config.columnKey]);
      if (value === null) return false;
      const target = condition.config.value;
      switch (condition.config.operator) {
        case 'gt':
          return value > target;
        case 'gte':
          return value >= target;
        case 'lt':
          return value < target;
        case 'lte':
          return value <= target;
        case 'eq':
          return value === target;
        default:
          return value !== target;
      }
    }
  }
}

export function allConditionsHold(
  conditions: readonly AutomationConditionRecipe[],
  subject: ConditionSubject,
): boolean {
  return conditions.every((condition) => conditionHolds(condition, subject));
}

/** Render `{name}` / `{board}` placeholders. */
export function renderTemplate(template: string, vars: { name: string; board: string }): string {
  return template.replace(/\{(name|board)\}/g, (_, key: 'name' | 'board') => vars[key]).slice(0, 2_000);
}
