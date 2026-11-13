/**
 * Autocomplete for the quick-add box: while the caret sits in a word that starts with @, # or +,
 * suggest people, labels or projects, and complete the word with text the parser resolves exactly.
 * Pure, so it's unit tested.
 */
export type SuggestSigil = '@' | '#' | '+';

export interface ActiveToken {
  readonly sigil: SuggestSigil;
  /** Text typed after the sigil (may be empty). */
  readonly partial: string;
  /** Range of the whole word incl. sigil. */
  readonly start: number;
  readonly end: number;
}

export interface Suggestion {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  /** Replacement text incl. sigil, e.g. "@Maya.Chen". */
  readonly insert: string;
}

/** The @/#/+ word the caret is in (or right after), if any. */
export function activeToken(text: string, caret: number): ActiveToken | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)([@#+])([\p{L}\p{N}._-]*)$/u.exec(before);
  if (!match) return null;
  const start = match.index + match[1]!.length;
  const rest = /^[\p{L}\p{N}._-]*/u.exec(text.slice(caret))?.[0] ?? '';
  return { sigil: match[2] as SuggestSigil, partial: match[3]!, start, end: caret + rest.length };
}

const squash = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '');

/** Prefix matches on any word first, then substring matches. */
function rank<T>(items: readonly T[], partial: string, keys: (item: T) => readonly string[], limit: number): T[] {
  const q = squash(partial);
  if (!q) return items.slice(0, limit);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const words = keys(item).flatMap((key) => [key, ...key.split(/[\s._-]+/)]).map(squash).filter(Boolean);
    const score = words.some((w) => w === q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : words.some((w) => w.includes(q)) ? 2 : -1;
    if (score >= 0) scored.push({ item, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.item).slice(0, limit);
}

export function suggestFor(
  token: ActiveToken,
  data: {
    readonly people: readonly { id: string; name: string; email?: string | null }[];
    readonly labels: readonly { id: string; name: string }[];
    readonly projects: readonly { id: string; key: string; name: string }[];
    readonly meId?: string | null;
  },
  limit = 6,
): Suggestion[] {
  if (token.sigil === '@') {
    const people = rank(data.people, token.partial, (p) => [p.name, p.email?.split('@')[0] ?? ''], limit);
    const out: Suggestion[] = people.map((p) => ({ id: p.id, label: p.name, detail: p.email ?? undefined, insert: `@${p.name.trim().replace(/\s+/g, '.')}` }));
    if (data.meId && 'me'.startsWith(squash(token.partial)) && !out.some((s) => s.id === data.meId)) {
      out.unshift({ id: data.meId, label: 'Me', detail: 'Assign to yourself', insert: '@me' });
    }
    return out.slice(0, limit);
  }
  if (token.sigil === '#') {
    const labels = rank(data.labels, token.partial, (l) => [l.name], limit);
    const out: Suggestion[] = labels.map((l) => ({ id: l.id, label: l.name, insert: `#${l.name.trim().replace(/\s+/g, '-')}` }));
    const typed = token.partial.trim();
    if (typed && !data.labels.some((l) => squash(l.name) === squash(typed))) {
      out.push({ id: `new:${typed}`, label: `Create “${typed.replace(/[-_]+/g, ' ')}”`, detail: 'New label', insert: `#${typed}` });
    }
    return out.slice(0, limit);
  }
  return rank(data.projects, token.partial, (p) => [p.key, p.name], limit).map((p) => ({ id: p.id, label: p.name, detail: p.key, insert: `+${p.key}` }));
}

/** Replace the active word with the suggestion (plus a trailing space). Returns the new text and caret. */
export function applySuggestion(text: string, token: ActiveToken, suggestion: Suggestion): { text: string; caret: number } {
  const after = text.slice(token.end);
  const spacer = after.startsWith(' ') ? '' : ' ';
  const next = `${text.slice(0, token.start)}${suggestion.insert}${spacer}${after}`;
  return { text: next, caret: token.start + suggestion.insert.length + 1 };
}
