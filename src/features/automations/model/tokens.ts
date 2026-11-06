/**
 * Token model for the sentence builder. A clause ("When Stage changes to Won") is a list of text
 * segments and tokens; each token is an editable chip whose value is chosen in a picker.
 */
import type { ColumnType } from '@/server/db/schema/cell-values';

export const ANY = '__any__';

export interface PeopleValue {
  readonly userIds: readonly string[];
  /** People column whose assignees are included (notify). */
  readonly columnKey: string | null;
  /** The person whose change triggered the automation (assign). */
  readonly actor: boolean;
}

export type TokenValue = string | number | readonly string[] | PeopleValue | null;

interface TokenBase {
  /** Generic placeholder shown while unset ("status", "something", "someone"). */
  readonly placeholder: string;
  /** Optional tokens never block saving (an unset optional token means "any" / default). */
  readonly optional?: boolean;
}

export type TokenSpec =
  | (TokenBase & { readonly kind: 'column'; readonly types: readonly ColumnType[] | 'editable' })
  | (TokenBase & { readonly kind: 'label'; readonly columnToken: string; readonly anyLabel?: string })
  | (TokenBase & { readonly kind: 'labels'; readonly columnToken: string })
  | (TokenBase & { readonly kind: 'group' })
  | (TokenBase & {
      readonly kind: 'people';
      readonly allowColumn: boolean;
      readonly allowActor: boolean;
    })
  | (TokenBase & { readonly kind: 'user'; readonly anyLabel?: string })
  | (TokenBase & { readonly kind: 'text'; readonly maxLength: number })
  | (TokenBase & { readonly kind: 'relativeDays'; readonly style: 'trigger' | 'action' })
  | (TokenBase & { readonly kind: 'number' })
  | (TokenBase & { readonly kind: 'operator' })
  | (TokenBase & { readonly kind: 'board' })
  | (TokenBase & { readonly kind: 'targetGroup'; readonly boardToken: string });

export type TokenKind = TokenSpec['kind'];

/** Column types that can be the subject of "column changes" / "is empty" / "clear". */
export const NON_EDITABLE_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'name',
  'formula',
  'mirror',
  'last_updated',
  'creation_log',
  'item_id',
  'button',
  'progress',
]);

export function columnTypeMatches(spec: Extract<TokenSpec, { kind: 'column' }>, type: ColumnType): boolean {
  if (spec.types === 'editable') return !NON_EDITABLE_TYPES.has(type);
  return spec.types.includes(type);
}

export const OPERATORS = [
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'at most' },
  { value: 'eq', label: 'equal to' },
  { value: 'neq', label: 'not equal to' },
] as const;

export function isPeopleValue(value: TokenValue | undefined): value is PeopleValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'userIds' in value;
}

export function isTokenSet(spec: TokenSpec, value: TokenValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  switch (spec.kind) {
    case 'labels':
      return Array.isArray(value) && value.length > 0;
    case 'people':
      return isPeopleValue(value) && (value.userIds.length > 0 || value.columnKey !== null || value.actor);
    case 'text':
      return typeof value === 'string' && value.trim().length > 0;
    case 'number':
    case 'relativeDays':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === 'string' && value.length > 0;
  }
}

/** "7 days before" / "the day of" (trigger) or "today" / "in 7 days" / "7 days ago" (action). */
export function describeRelativeDays(days: number, style: 'trigger' | 'action'): string {
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  if (style === 'trigger') {
    if (days === 0) return 'the day of';
    return days < 0 ? `${n} ${unit} before` : `${n} ${unit} after`;
  }
  if (days === 0) return 'today';
  return days > 0 ? `${n} ${unit} from today` : `${n} ${unit} ago`;
}
