/**
 * Clause catalog: every trigger / condition / action the automations engine supports
 * (src/server/automations-engine/recipes.ts), expressed as a sentence with editable tokens and a
 * lossless mapping to and from the engine's stored `config`.
 *
 * `toConfig(values, base)` spreads `base` (the stored config) first, so engine fields the builder
 * does not expose (e.g. `fromLabelId`, `copyValues`) survive an edit.
 */
import { ANY, isPeopleValue, type PeopleValue, type TokenSpec, type TokenValue } from './tokens';

export type ClauseRole = 'trigger' | 'condition' | 'action';
export type ClauseValues = Readonly<Record<string, TokenValue>>;
export type Config = Record<string, unknown>;

/** A sentence part: literal text, `%item%` (board terminology with article) or a token id. */
export type Segment = string | { readonly token: string };

export interface ClauseDef {
  readonly type: string;
  readonly role: ClauseRole;
  /** Menu label in the custom builder ("When status changes"). */
  readonly title: string;
  readonly menuGroup: string;
  readonly segments: readonly Segment[];
  /** Value-dependent wording (e.g. "When Close date arrives" vs "When it’s 7 days before …"). */
  readonly segmentsFor?: (values: ClauseValues) => readonly Segment[];
  readonly tokens: Readonly<Record<string, TokenSpec>>;
  toConfig(values: ClauseValues, base: Config): Config;
  fromConfig(config: Config): ClauseValues;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const tokenString = (value: TokenValue | undefined): string | undefined =>
  typeof value === 'string' && value.length > 0 && value !== ANY ? value : undefined;
const tokenNumber = (value: TokenValue | undefined, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Drop keys whose value is undefined so optional engine fields stay absent. */
function compact(config: Config): Config {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

function people(value: TokenValue | undefined): PeopleValue {
  return isPeopleValue(value) ? value : { userIds: [], columnKey: null, actor: false };
}

const COLUMN_PEOPLE: TokenSpec = { kind: 'column', types: ['people'], placeholder: 'a people column' };
const COLUMN_STATUS: TokenSpec = { kind: 'column', types: ['status'], placeholder: 'a status' };
const COLUMN_DATE: TokenSpec = { kind: 'column', types: ['date'], placeholder: 'a date' };
const COLUMN_ANY: TokenSpec = { kind: 'column', types: 'editable', placeholder: 'a column' };

// Triggers ------------------------------------------------------------------------------------

const TRIGGERS: readonly ClauseDef[] = [
  {
    type: 'status_changed',
    role: 'trigger',
    title: 'When status changes',
    menuGroup: 'Column changes',
    segments: ['When ', { token: 'column' }, ' changes to ', { token: 'to' }],
    tokens: {
      column: COLUMN_STATUS,
      to: { kind: 'label', columnToken: 'column', placeholder: 'something', anyLabel: 'anything' },
    },
    toConfig: (v, base) =>
      compact({ ...base, columnKey: tokenString(v.column), toLabelId: tokenString(v.to) }),
    fromConfig: (c) => ({ column: str(c.columnKey), to: str(c.toLabelId) ?? ANY }),
  },
  {
    type: 'column_changed',
    role: 'trigger',
    title: 'When a column changes',
    menuGroup: 'Column changes',
    segments: ['When ', { token: 'column' }, ' changes'],
    tokens: { column: COLUMN_ANY },
    toConfig: (v, base) => compact({ ...base, columnKey: tokenString(v.column) }),
    fromConfig: (c) => ({ column: str(c.columnKey) }),
  },
  {
    type: 'person_assigned',
    role: 'trigger',
    title: 'When a person is assigned',
    menuGroup: 'Column changes',
    segments: ['When ', { token: 'user' }, ' is assigned to ', { token: 'column' }],
    tokens: {
      user: { kind: 'user', placeholder: 'someone', anyLabel: 'anyone' },
      column: COLUMN_PEOPLE,
    },
    toConfig: (v, base) =>
      compact({ ...base, columnKey: tokenString(v.column), userId: tokenString(v.user) }),
    fromConfig: (c) => ({ column: str(c.columnKey), user: str(c.userId) ?? ANY }),
  },
  {
    type: 'item_created',
    role: 'trigger',
    title: 'When an item is created',
    menuGroup: 'Items',
    segments: ['When ', '%item%', ' is created'],
    tokens: {},
    toConfig: () => ({}),
    fromConfig: () => ({}),
  },
  {
    type: 'item_moved_to_group',
    role: 'trigger',
    title: 'When an item moves to a group',
    menuGroup: 'Items',
    segments: ['When ', '%item%', ' is moved to ', { token: 'group' }],
    tokens: { group: { kind: 'group', placeholder: 'group' } },
    toConfig: (v, base) => compact({ ...base, groupId: tokenString(v.group) }),
    fromConfig: (c) => ({ group: str(c.groupId) }),
  },
  {
    type: 'date_arrived',
    role: 'trigger',
    title: 'When a date arrives',
    menuGroup: 'Dates & time',
    // "When it’s the day of Close date" · "When it’s 1 day before Close date".
    segments: ['When it’s ', { token: 'offset' }, ' ', { token: 'column' }],
    tokens: {
      offset: { kind: 'relativeDays', style: 'trigger', placeholder: 'the day of' },
      column: { ...COLUMN_DATE, placeholder: 'the due date' },
    },
    toConfig: (v, base) =>
      compact({ ...base, columnKey: tokenString(v.column), offsetDays: tokenNumber(v.offset) }),
    fromConfig: (c) => ({ column: str(c.columnKey), offset: num(c.offsetDays) ?? 0 }),
  },
];

// Conditions ----------------------------------------------------------------------------------

const CONDITIONS: readonly ClauseDef[] = [
  {
    type: 'status_is',
    role: 'condition',
    title: 'Status is…',
    menuGroup: 'Values',
    segments: [{ token: 'column' }, ' is ', { token: 'labels' }],
    tokens: {
      column: COLUMN_STATUS,
      labels: { kind: 'labels', columnToken: 'column', placeholder: 'something' },
    },
    toConfig: (v, base) =>
      compact({
        ...base,
        columnKey: tokenString(v.column),
        labelIds: Array.isArray(v.labels) ? [...v.labels] : [],
      }),
    fromConfig: (c) => ({ column: str(c.columnKey), labels: strings(c.labelIds) }),
  },
  {
    type: 'column_not_empty',
    role: 'condition',
    title: 'Column is not empty',
    menuGroup: 'Values',
    segments: [{ token: 'column' }, ' is not empty'],
    tokens: { column: COLUMN_ANY },
    toConfig: (v, base) => compact({ ...base, columnKey: tokenString(v.column) }),
    fromConfig: (c) => ({ column: str(c.columnKey) }),
  },
  {
    type: 'column_is_empty',
    role: 'condition',
    title: 'Column is empty',
    menuGroup: 'Values',
    segments: [{ token: 'column' }, ' is empty'],
    tokens: { column: COLUMN_ANY },
    toConfig: (v, base) => compact({ ...base, columnKey: tokenString(v.column) }),
    fromConfig: (c) => ({ column: str(c.columnKey) }),
  },
  {
    type: 'number_compare',
    role: 'condition',
    title: 'Number meets a threshold',
    menuGroup: 'Values',
    segments: [{ token: 'column' }, ' is ', { token: 'operator' }, ' ', { token: 'value' }],
    tokens: {
      column: { kind: 'column', types: ['number', 'currency', 'rating'], placeholder: 'number' },
      operator: { kind: 'operator', placeholder: 'compared to' },
      value: { kind: 'number', placeholder: 'a value' },
    },
    toConfig: (v, base) =>
      compact({
        ...base,
        columnKey: tokenString(v.column),
        operator: tokenString(v.operator),
        value: typeof v.value === 'number' ? v.value : undefined,
      }),
    fromConfig: (c) => ({ column: str(c.columnKey), operator: str(c.operator), value: num(c.value) }),
  },
  {
    type: 'person_is',
    role: 'condition',
    title: 'Person is assigned',
    menuGroup: 'People & groups',
    segments: [{ token: 'column' }, ' includes ', { token: 'user' }],
    tokens: { column: COLUMN_PEOPLE, user: { kind: 'user', placeholder: 'someone' } },
    toConfig: (v, base) =>
      compact({ ...base, columnKey: tokenString(v.column), userId: tokenString(v.user) }),
    fromConfig: (c) => ({ column: str(c.columnKey), user: str(c.userId) }),
  },
  {
    type: 'in_group',
    role: 'condition',
    title: 'Item is in group',
    menuGroup: 'People & groups',
    segments: ['%item%', ' is in ', { token: 'group' }],
    tokens: { group: { kind: 'group', placeholder: 'group' } },
    toConfig: (v, base) => compact({ ...base, groupId: tokenString(v.group) }),
    fromConfig: (c) => ({ group: str(c.groupId) }),
  },
];

// Actions -------------------------------------------------------------------------------------

const ACTIONS: readonly ClauseDef[] = [
  {
    type: 'notify',
    role: 'action',
    title: 'Notify',
    menuGroup: 'Communicate',
    segments: ['notify ', { token: 'who' }, ' with ', { token: 'message' }],
    tokens: {
      who: { kind: 'people', allowColumn: true, allowActor: false, placeholder: 'someone' },
      message: { kind: 'text', maxLength: 2_000, placeholder: 'a message' },
    },
    toConfig: (v, base) => {
      const who = people(v.who);
      return compact({
        ...base,
        userIds: [...who.userIds],
        peopleColumnKey: who.columnKey ?? undefined,
        message: typeof v.message === 'string' ? v.message.trim() : undefined,
      });
    },
    fromConfig: (c) => ({
      who: { userIds: strings(c.userIds), columnKey: str(c.peopleColumnKey), actor: false },
      message: str(c.message),
    }),
  },
  {
    type: 'create_update',
    role: 'action',
    title: 'Post an update',
    menuGroup: 'Communicate',
    segments: ['post the update ', { token: 'body' }],
    tokens: { body: { kind: 'text', maxLength: 2_000, placeholder: 'a message' } },
    toConfig: (v, base) => compact({ ...base, body: typeof v.body === 'string' ? v.body.trim() : undefined }),
    fromConfig: (c) => ({ body: str(c.body) }),
  },
  {
    type: 'set_status',
    role: 'action',
    title: 'Change status',
    menuGroup: 'Update the item',
    segments: ['change ', { token: 'column' }, ' to ', { token: 'label' }],
    tokens: {
      column: COLUMN_STATUS,
      label: { kind: 'label', columnToken: 'column', placeholder: 'something' },
    },
    toConfig: (v, base) =>
      compact({ ...base, columnKey: tokenString(v.column), labelId: tokenString(v.label) }),
    fromConfig: (c) => ({ column: str(c.columnKey), label: str(c.labelId) }),
  },
  {
    type: 'assign_person',
    role: 'action',
    title: 'Assign a person',
    menuGroup: 'Update the item',
    segments: ['assign ', { token: 'who' }, ' as ', { token: 'column' }],
    tokens: {
      who: { kind: 'people', allowColumn: false, allowActor: true, placeholder: 'someone' },
      column: { ...COLUMN_PEOPLE, placeholder: 'the owner' },
    },
    toConfig: (v, base) => {
      const who = people(v.who);
      return compact({
        mode: 'add',
        ...base,
        columnKey: tokenString(v.column),
        userIds: [...who.userIds],
        assignActor: who.actor,
      });
    },
    fromConfig: (c) => ({
      who: { userIds: strings(c.userIds), columnKey: null, actor: c.assignActor === true },
      column: str(c.columnKey),
    }),
  },
  {
    type: 'set_date',
    role: 'action',
    title: 'Set a date',
    menuGroup: 'Update the item',
    segments: ['set ', { token: 'column' }, ' to ', { token: 'offset' }],
    tokens: { column: COLUMN_DATE, offset: { kind: 'relativeDays', style: 'action', placeholder: 'today' } },
    toConfig: (v, base) =>
      compact({ ...base, columnKey: tokenString(v.column), offsetDays: tokenNumber(v.offset) }),
    fromConfig: (c) => ({ column: str(c.columnKey), offset: num(c.offsetDays) ?? 0 }),
  },
  {
    type: 'clear_column',
    role: 'action',
    title: 'Clear a column',
    menuGroup: 'Update the item',
    segments: ['clear ', { token: 'column' }],
    tokens: { column: COLUMN_ANY },
    toConfig: (v, base) => compact({ ...base, columnKey: tokenString(v.column) }),
    fromConfig: (c) => ({ column: str(c.columnKey) }),
  },
  {
    type: 'move_to_group',
    role: 'action',
    title: 'Move to group',
    menuGroup: 'Move & archive',
    segments: ['move ', '%item%', ' to ', { token: 'group' }],
    tokens: { group: { kind: 'group', placeholder: 'group' } },
    toConfig: (v, base) => compact({ ...base, groupId: tokenString(v.group) }),
    fromConfig: (c) => ({ group: str(c.groupId) }),
  },
  {
    type: 'archive_item',
    role: 'action',
    title: 'Archive the item',
    menuGroup: 'Move & archive',
    segments: ['archive ', '%item%'],
    tokens: {},
    toConfig: () => ({}),
    fromConfig: () => ({}),
  },
  {
    type: 'create_item',
    role: 'action',
    title: 'Create an item on a board',
    menuGroup: 'Create',
    segments: [
      'create an item on ',
      { token: 'board' },
      ' in ',
      { token: 'group' },
      ' named ',
      { token: 'name' },
    ],
    tokens: {
      board: { kind: 'board', placeholder: 'a board' },
      group: { kind: 'targetGroup', boardToken: 'board', placeholder: 'the top group', optional: true },
      name: { kind: 'text', maxLength: 500, placeholder: '{name}' },
    },
    toConfig: (v, base) => {
      const boardId = tokenString(v.board);
      const sameBoard = boardId !== undefined && boardId === base.boardId;
      return compact({
        ...base,
        boardId,
        // A different target board invalidates the stored group / column mapping.
        groupId: tokenString(v.group),
        copyValues: sameBoard ? base.copyValues : undefined,
        linkColumnKey: sameBoard ? base.linkColumnKey : undefined,
        nameTemplate: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : '{name}',
      });
    },
    fromConfig: (c) => ({
      board: str(c.boardId),
      group: str(c.groupId),
      name: str(c.nameTemplate) ?? '{name}',
    }),
  },
];

export const CLAUSES: readonly ClauseDef[] = [...TRIGGERS, ...CONDITIONS, ...ACTIONS];

const BY_KEY = new Map(CLAUSES.map((def) => [`${def.role}:${def.type}`, def]));

export function clauseDef(role: ClauseRole, type: string): ClauseDef | undefined {
  return BY_KEY.get(`${role}:${type}`);
}

export function clausesFor(role: ClauseRole): readonly ClauseDef[] {
  return CLAUSES.filter((def) => def.role === role);
}

export function tokenIds(def: ClauseDef): string[] {
  return def.segments.flatMap((segment) => (typeof segment === 'string' ? [] : [segment.token]));
}
