/** Automation action executors. Each runs through the regular services (validation, RBAC, activity). */
import type { BoardRow, ItemRow } from '@/server/services/access';
import type { ServiceContext } from '@/server/services/context';
import { createItem, changeItemLifecycle, moveItem, updateItem } from '@/server/services/items';
import { notify } from '@/server/services/notifications';
import { plainTextToDoc } from '@/server/services/rich-text';
import { createUpdate } from '@/server/services/updates';
import { renderTemplate } from './matching';
import type { AutomationActionRecipe } from './recipes';

export interface ActionContext {
  /** Service context attributed to the automation (depth incremented). */
  readonly ctx: ServiceContext;
  readonly item: ItemRow;
  readonly board: BoardRow;
  /** User whose action triggered the automation (null for scheduled triggers). */
  readonly triggeredBy: string | null;
}

export type ActionOutcome = { readonly type: string; readonly detail?: Record<string, unknown> };

function addDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function peopleIn(value: unknown): string[] {
  const ids = (value as { ids?: unknown } | null | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export async function executeAction(
  action: AutomationActionRecipe,
  input: ActionContext,
): Promise<ActionOutcome> {
  const { ctx, item, board } = input;
  const vars = { name: item.name, board: board.name };
  switch (action.type) {
    case 'set_column':
      await updateItem(ctx, item.id, { values: { [action.config.columnKey]: action.config.value ?? null } });
      return {
        type: action.type,
        detail: { columnKey: action.config.columnKey, value: action.config.value ?? null },
      };
    case 'set_status':
      await updateItem(ctx, item.id, {
        values: { [action.config.columnKey]: { labelId: action.config.labelId } },
      });
      return {
        type: action.type,
        detail: { columnKey: action.config.columnKey, labelId: action.config.labelId },
      };
    case 'clear_column':
      await updateItem(ctx, item.id, { values: { [action.config.columnKey]: null } });
      return { type: action.type, detail: { columnKey: action.config.columnKey } };
    case 'set_date': {
      const date = addDays(action.config.offsetDays);
      await updateItem(ctx, item.id, { values: { [action.config.columnKey]: { date } } });
      return { type: action.type, detail: { columnKey: action.config.columnKey, date } };
    }
    case 'move_to_group':
      if (item.parentItemId) return { type: action.type, detail: { skipped: 'subitem' } };
      await moveItem(ctx, item.id, { groupId: action.config.groupId });
      return { type: action.type, detail: { groupId: action.config.groupId } };
    case 'notify': {
      const recipients = new Set(action.config.userIds);
      if (action.config.peopleColumnKey)
        for (const id of peopleIn(item.values[action.config.peopleColumnKey])) recipients.add(id);
      const notified = await notify(ctx, {
        kind: 'automation',
        recipients: [...recipients],
        boardId: board.id,
        itemId: item.id,
        includeActor: true,
        payload: {
          message: renderTemplate(action.config.message, vars),
          itemName: item.name,
          boardName: board.name,
        },
      });
      return { type: action.type, detail: { notified: notified.length } };
    }
    case 'assign_person': {
      const additions = new Set(action.config.userIds);
      if (action.config.assignActor && input.triggeredBy) additions.add(input.triggeredBy);
      const current = action.config.mode === 'replace' ? [] : peopleIn(item.values[action.config.columnKey]);
      const ids = [...new Set([...current, ...additions])];
      await updateItem(ctx, item.id, { values: { [action.config.columnKey]: ids.length ? { ids } : null } });
      return { type: action.type, detail: { columnKey: action.config.columnKey, ids } };
    }
    case 'create_item': {
      const values: Record<string, unknown> = {};
      for (const [sourceKey, targetKey] of Object.entries(action.config.copyValues)) {
        if (item.values[sourceKey] !== undefined) values[targetKey] = item.values[sourceKey];
      }
      if (action.config.linkColumnKey) values[action.config.linkColumnKey] = { itemIds: [item.id] };
      const created = await createItem(ctx, action.config.boardId, {
        name: renderTemplate(action.config.nameTemplate, vars),
        groupId: action.config.groupId,
        values,
      });
      return { type: action.type, detail: { itemId: created.id, boardId: action.config.boardId } };
    }
    case 'create_update': {
      const update = await createUpdate(ctx, item.id, {
        body: plainTextToDoc(renderTemplate(action.config.body, vars)) as {
          type: 'doc';
          content?: unknown[];
        },
      });
      return { type: action.type, detail: { updateId: update.id } };
    }
    case 'archive_item':
      await changeItemLifecycle(ctx, item.id, 'archive');
      return { type: action.type };
  }
}
