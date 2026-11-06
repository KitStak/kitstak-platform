/**
 * Builder draft: trigger + conditions + actions as clauses with token values. Pure functions to
 * create drafts (blank, from a recipe, from a stored automation), list missing tokens, compile
 * to the engine recipe and render the plain-English sentence.
 */
import { createAutomationSchema, type CreateAutomationInput } from '@/server/automations-engine/recipes';
import type { AutomationDto } from '@/server/services/contracts/dto';
import {
  clauseDef,
  tokenIds,
  type ClauseDef,
  type ClauseRole,
  type ClauseValues,
  type Config,
} from './clauses';
import { humanizeTemplate } from './template';
import { ANY, isTokenSet, type TokenValue } from './tokens';

export interface ClauseDraft {
  readonly key: string;
  readonly role: ClauseRole;
  readonly type: string;
  readonly values: ClauseValues;
  /** Stored engine config the draft started from (keeps fields the builder does not edit). */
  readonly base: Config;
}

export interface AutomationDraft {
  readonly trigger: ClauseDraft | null;
  readonly conditions: readonly ClauseDraft[];
  readonly actions: readonly ClauseDraft[];
}

let keySeq = 0;
export function nextKey(): string {
  keySeq += 1;
  return `c${keySeq}`;
}

export function newClause(
  role: ClauseRole,
  type: string,
  values: ClauseValues = {},
  base: Config = {},
): ClauseDraft {
  return { key: nextKey(), role, type, values, base };
}

export const EMPTY_DRAFT: AutomationDraft = { trigger: null, conditions: [], actions: [] };

function fromStored(role: ClauseRole, part: { type: string; config?: Record<string, unknown> }): ClauseDraft {
  const def = clauseDef(role, part.type);
  const config = part.config ?? {};
  return newClause(role, part.type, def ? def.fromConfig(config) : {}, config);
}

export function draftFromAutomation(
  automation: Pick<AutomationDto, 'trigger' | 'conditions' | 'actions'>,
): AutomationDraft {
  return {
    trigger: fromStored('trigger', automation.trigger),
    conditions: automation.conditions.map((part) => fromStored('condition', part)),
    actions: automation.actions.map((part) => fromStored('action', part)),
  };
}

export function allClauses(draft: AutomationDraft): ClauseDraft[] {
  return [...(draft.trigger ? [draft.trigger] : []), ...draft.conditions, ...draft.actions];
}

export interface MissingToken {
  readonly clauseKey: string;
  readonly token: string;
}

/** Required tokens that still have no value, in sentence order. */
export function missingTokens(draft: AutomationDraft): MissingToken[] {
  const missing: MissingToken[] = [];
  for (const clause of allClauses(draft)) {
    const def = clauseDef(clause.role, clause.type);
    if (!def) continue;
    for (const token of tokenIds(def)) {
      const spec = def.tokens[token];
      if (!spec || spec.optional) continue;
      const value = clause.values[token];
      // Tokens with an "any" option count as set once the user picked a value (including "any").
      if (value === ANY) continue;
      if (!isTokenSet(spec, value)) missing.push({ clauseKey: clause.key, token });
    }
  }
  return missing;
}

export type DraftProblem = 'no-trigger' | 'no-action' | 'unsupported' | 'incomplete';

export function draftProblems(draft: AutomationDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draft.trigger) problems.push('no-trigger');
  if (draft.actions.length === 0) problems.push('no-action');
  if (allClauses(draft).some((clause) => !clauseDef(clause.role, clause.type))) problems.push('unsupported');
  if (missingTokens(draft).length > 0) problems.push('incomplete');
  return problems;
}

function compileClause(clause: ClauseDraft): { type: string; config: Config } {
  const def = clauseDef(clause.role, clause.type);
  return { type: clause.type, config: def ? def.toConfig(clause.values, clause.base) : clause.base };
}

export type CompileResult =
  | { readonly ok: true; readonly input: CreateAutomationInput }
  | { readonly ok: false; readonly message: string };

/** Compile + validate with the engine's own schema (the server validates again). */
export function compileDraft(
  draft: AutomationDraft,
  meta: { name: string; description?: string | null; enabled?: boolean },
): CompileResult {
  if (!draft.trigger) return { ok: false, message: 'Choose what starts the automation' };
  if (draft.actions.length === 0) return { ok: false, message: 'Add at least one action' };
  if (missingTokens(draft).length > 0) return { ok: false, message: 'Fill in all fields' };
  const parsed = createAutomationSchema.safeParse({
    name: meta.name,
    description: meta.description ?? null,
    enabled: meta.enabled ?? true,
    trigger: compileClause(draft.trigger),
    conditions: draft.conditions.map(compileClause),
    actions: draft.actions.map(compileClause),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'The automation is invalid' };
  return { ok: true, input: parsed.data };
}

// Sentence rendering --------------------------------------------------------------------------

/** Resolves token values to display text (column titles, label names, people...). */
export interface TokenResolver {
  readonly term: string;
  display(def: ClauseDef, clause: ClauseDraft, token: string, value: TokenValue | undefined): string | null;
}

export type SentencePart =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'token';
      readonly clauseKey: string;
      readonly token: string;
      readonly text: string;
      readonly set: boolean;
    };

export function itemPhrase(term: string): string {
  const word = term.trim().toLowerCase() || 'item';
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

export function clauseParts(
  clause: ClauseDraft,
  resolver: TokenResolver,
  options: { definite?: boolean; omitLead?: boolean } = {},
): SentencePart[] {
  const def = clauseDef(clause.role, clause.type);
  if (!def) return [{ kind: 'text', text: clause.type.replaceAll('_', ' ') }];
  const term = resolver.term.trim().toLowerCase() || 'item';
  const parts = (def.segmentsFor?.(clause.values) ?? def.segments).map((segment): SentencePart => {
    if (typeof segment === 'string') {
      if (segment === '%item%')
        return { kind: 'text', text: options.definite ? `the ${term}` : itemPhrase(term) };
      return { kind: 'text', text: segment };
    }
    const spec = def.tokens[segment.token];
    const value = clause.values[segment.token];
    const shown = resolver.display(def, clause, segment.token, value);
    const set = shown !== null && (value === ANY || (spec ? isTokenSet(spec, value) : false));
    return {
      kind: 'token',
      clauseKey: clause.key,
      token: segment.token,
      text: shown ?? spec?.placeholder ?? segment.token,
      set: set || (spec?.optional === true && shown !== null),
    };
  });
  return options.omitLead ? withoutLead(parts) : parts;
}

/** Drop a leading "When " (the WHEN step card already says it) and capitalize what follows. */
function withoutLead(parts: SentencePart[]): SentencePart[] {
  const first = parts[0];
  if (!first || first.kind !== 'text' || !/^when\s/i.test(first.text)) return parts;
  const rest = first.text.replace(/^when\s+/i, '');
  const capitalize = (text: string) => text.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
  if (rest) return [{ kind: 'text', text: capitalize(rest) }, ...parts.slice(1)];
  const [next, ...tail] = parts.slice(1);
  if (next?.kind === 'text') return [{ kind: 'text', text: capitalize(next.text) }, ...tail];
  return parts.slice(1);
}

const JOIN = { condition: 'and only if ', action: 'then ' } as const;

/** Full sentence: "When …, and only if …, then … and …". */
export function draftParts(draft: AutomationDraft, resolver: TokenResolver): SentencePart[] {
  const parts: SentencePart[] = [];
  if (draft.trigger) parts.push(...clauseParts(draft.trigger, resolver));
  else parts.push({ kind: 'text', text: 'When…' });
  draft.conditions.forEach((condition, index) => {
    parts.push({ kind: 'text', text: index === 0 ? `, ${JOIN.condition}` : ' and ' });
    parts.push(...clauseParts(condition, resolver, { definite: true }));
  });
  draft.actions.forEach((action, index) => {
    const last = index === draft.actions.length - 1;
    parts.push({ kind: 'text', text: index === 0 ? `, ${JOIN.action}` : last ? ' and ' : ', ' });
    parts.push(...clauseParts(action, resolver, { definite: true }));
  });
  return parts;
}

/** Plain text of a sentence; `{name}` / `{board}` become "Item name" / "Board name". */
export function partsToText(parts: readonly SentencePart[], term = 'Item'): string {
  return humanizeTemplate(
    parts
      .map((part) => part.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim(),
    term,
  );
}

/**
 * Auto-generated, editable name (the sentence, trimmed to fit). Empty until every required
 * token is set, so the name never contains placeholders like "something" or "someone".
 */
export function autoName(draft: AutomationDraft, resolver: TokenResolver): string {
  if (!draft.trigger || draft.actions.length === 0 || missingTokens(draft).length > 0) return '';
  const text = partsToText(draftParts(draft, resolver), resolver.term);
  return text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text;
}
