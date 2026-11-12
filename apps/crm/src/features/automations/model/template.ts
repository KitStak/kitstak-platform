/**
 * Message templates: the engine replaces `{name}` / `{board}` (see automations-engine/matching
 * `renderTemplate`). The UI never shows the braces; it renders them as "Item name" / "Board name"
 * chips and uses the same friendly labels in plain-text contexts (names, search, summaries).
 */
export type TemplateVar = 'name' | 'board';

export type TemplateSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'var'; readonly name: TemplateVar };

const VAR_PATTERN = /\{(name|board)\}/g;

export function hasTemplateVars(text: string): boolean {
  return /\{(name|board)\}/.test(text);
}

export function templateSegments(text: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(VAR_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) });
    segments.push({ kind: 'var', name: match[1] as TemplateVar });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** "Deal name" for a Deals board, "Item name" by default. */
export function templateVarLabel(name: TemplateVar, term = 'Item'): string {
  if (name === 'board') return 'Board name';
  const word = term.trim() || 'Item';
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} name`;
}

/** Plain text with friendly labels in place of `{name}` / `{board}`. */
export function humanizeTemplate(text: string, term = 'Item'): string {
  return text.replace(VAR_PATTERN, (_, name: TemplateVar) => templateVarLabel(name, term));
}
