/** Pure helpers for Inbox cards (unit-tested). */
import type { UpdateDto } from '@/server/services/contracts/dto';

export interface RichDoc {
  readonly type: 'doc';
  readonly content: readonly unknown[];
}

/** Plain composer text → Tiptap doc: one paragraph per line, empty lines kept as spacers. */
export function plainTextToDoc(text: string): RichDoc {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  return {
    type: 'doc',
    content: lines.map((line) =>
      line.length > 0
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' },
    ),
  };
}

export const COLLAPSE_CHARS = 320;
export const COLLAPSE_LINES = 5;

/** Whether an update body is long enough to need "Show more". */
export function needsCollapse(text: string, maxChars = COLLAPSE_CHARS, maxLines = COLLAPSE_LINES): boolean {
  return text.length > maxChars || text.split('\n').length > maxLines;
}

/** Collapsed preview: cut on a word boundary near the limit, max lines kept. */
export function collapseText(text: string, maxChars = COLLAPSE_CHARS, maxLines = COLLAPSE_LINES): string {
  if (!needsCollapse(text, maxChars, maxLines)) return text;
  let out = text.split('\n').slice(0, maxLines).join('\n');
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    const space = cut.lastIndexOf(' ');
    out = space > maxChars * 0.6 ? cut.slice(0, space) : cut;
  }
  return `${out.trimEnd()}…`;
}

/** Split text so `@Name` mentions of known people can be emphasized. */
export function splitMentions(
  text: string,
  names: readonly string[],
): { readonly text: string; readonly mention: boolean }[] {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return [{ text, mention: false }];
  const escaped = sorted.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(?:${escaped.join('|')})`, 'g');
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index), mention: false });
    parts.push({ text: match[0], mention: true });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
}

/** Unread for me: someone else wrote it and I have not read it (my own posts never are). */
export function isUnreadForMe(update: Pick<UpdateDto, 'id' | 'readByMe' | 'author'>, meId: string): boolean {
  return !update.readByMe && update.author?.id !== meId && !update.id.startsWith('temp-');
}
