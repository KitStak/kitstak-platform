/** Board context → token display text (used by the builder chips and list summaries). */
import type { LabelColor } from '@/server/db/schema/column-types';
import type { BoardSummaryDto, ColumnDto, GroupDto, UserSummaryDto } from '@/server/services/contracts/dto';
import type { ClauseDef } from './clauses';
import type { ClauseDraft, TokenResolver } from './draft';
import { ANY, describeRelativeDays, isPeopleValue, OPERATORS, type TokenValue } from './tokens';

export interface BoardLabel {
  readonly id: string;
  readonly name: string;
  readonly color: LabelColor;
  readonly isDone?: boolean;
}

export interface BuilderContext {
  readonly boardId: string;
  readonly term: string;
  readonly columns: readonly ColumnDto[];
  readonly groups: readonly GroupDto[];
  readonly users: readonly UserSummaryDto[];
  readonly boards: readonly BoardSummaryDto[];
  /** Groups of other boards (create_item targets), keyed by board id, when loaded. */
  readonly targetGroups?: Readonly<Record<string, readonly GroupDto[]>>;
}

export function columnLabels(column: ColumnDto | undefined): BoardLabel[] {
  const labels = (column?.settings as { labels?: unknown } | undefined)?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .filter(
      (
        label,
      ): label is { id: string; name: string; color: LabelColor; isDone?: boolean; position?: number } =>
        typeof label === 'object' && label !== null && typeof (label as { id?: unknown }).id === 'string',
    )
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((label) => ({
      id: label.id,
      name: label.name || 'Default',
      color: label.color,
      isDone: label.isDone,
    }));
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/** "Won" · "Lead or Won" · "Lead, Proposal or Won" · "Lead, Proposal or 2 others". */
export function joinAlternatives(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
  return `${names.slice(0, 2).join(', ')} or ${names.length - 2} others`;
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return `“${flat.length > 48 ? `${flat.slice(0, 46)}…` : flat}”`;
}

export function createResolver(context: BuilderContext): TokenResolver & {
  column(key: string | null | undefined): ColumnDto | undefined;
  label(columnKey: string | null | undefined, labelId: string): BoardLabel | undefined;
} {
  const columnByKey = new Map(context.columns.map((column) => [column.key, column]));
  const userById = new Map(context.users.map((user) => [user.id, user]));
  const groupById = new Map(context.groups.map((group) => [group.id, group]));
  const boardById = new Map(context.boards.map((board) => [board.id, board]));

  const column = (key: string | null | undefined) => (key ? columnByKey.get(key) : undefined);
  const label = (columnKey: string | null | undefined, labelId: string) =>
    columnLabels(column(columnKey)).find((entry) => entry.id === labelId);
  const userName = (id: string) => userById.get(id)?.name ?? 'Former member';

  function display(
    def: ClauseDef,
    clause: ClauseDraft,
    token: string,
    value: TokenValue | undefined,
  ): string | null {
    const spec = def.tokens[token];
    if (!spec) return null;
    if (value === ANY) return 'anyLabel' in spec && spec.anyLabel ? spec.anyLabel : null;
    switch (spec.kind) {
      case 'column':
        return typeof value === 'string' ? (column(value)?.title ?? 'deleted column') : null;
      case 'label': {
        if (typeof value !== 'string') return null;
        const columnKey = clause.values[spec.columnToken];
        return label(typeof columnKey === 'string' ? columnKey : null, value)?.name ?? 'deleted label';
      }
      case 'labels': {
        if (!Array.isArray(value) || value.length === 0) return null;
        const columnKey = clause.values[spec.columnToken];
        const names = value.map(
          (id) => label(typeof columnKey === 'string' ? columnKey : null, id)?.name ?? 'deleted label',
        );
        return joinAlternatives(names);
      }
      case 'group':
        return typeof value === 'string' ? (groupById.get(value)?.title ?? 'deleted group') : null;
      case 'targetGroup': {
        if (typeof value !== 'string') return spec.optional ? spec.placeholder : null;
        const boardId = clause.values[spec.boardToken];
        const groups = typeof boardId === 'string' ? context.targetGroups?.[boardId] : undefined;
        const local = typeof boardId === 'string' && boardId === context.boardId ? context.groups : groups;
        return local?.find((group) => group.id === value)?.title ?? 'selected group';
      }
      case 'board':
        return typeof value === 'string' ? (boardById.get(value)?.name ?? 'another board') : null;
      case 'people': {
        if (!isPeopleValue(value)) return null;
        const names = [
          ...(value.actor ? ['whoever triggered it'] : []),
          ...(value.columnKey ? [`people in ${column(value.columnKey)?.title ?? 'a deleted column'}`] : []),
          ...value.userIds.map(userName),
        ];
        return names.length > 0 ? joinNames(names) : null;
      }
      case 'user':
        return typeof value === 'string' ? userName(value) : null;
      case 'text':
        return typeof value === 'string' && value.trim() ? quote(value) : null;
      case 'relativeDays':
        return typeof value === 'number' ? describeRelativeDays(value, spec.style) : null;
      case 'number':
        return typeof value === 'number' ? value.toLocaleString() : null;
      case 'operator':
        return OPERATORS.find((operator) => operator.value === value)?.label ?? null;
      default:
        return null;
    }
  }

  return { term: context.term, display, column, label };
}
