/**
 * Server-side sanitizer for Tiptap / ProseMirror JSON. Rebuilds the document from an
 * allow-list of node types, attributes and marks so nothing unexpected (scripts, event
 * handlers, javascript: URLs, arbitrary HTML) can be stored or rendered.
 */
import type { RichTextDoc } from '@/server/db/schema';
import { ValidationError } from '@/server/http/errors';

const MAX_TEXT_CHARS = 50_000;
const MAX_NODES = 10_000;
const MAX_DEPTH = 32;

type JsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  text?: string;
  marks?: JsonMark[];
};
type JsonMark = { type: string; attrs?: Record<string, unknown> };

const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'taskList',
  'taskItem',
]);
const INLINE_NODES = new Set(['text', 'hardBreak', 'mention']);
const MARKS = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight']);
const SAFE_URL = /^(https?:|mailto:)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface SanitizeState {
  nodes: number;
  textChars: number;
  text: string[];
  mentions: Set<string>;
}

function sanitizeMarks(raw: unknown): JsonMark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const marks: JsonMark[] = [];
  for (const mark of raw.slice(0, 10)) {
    if (!isRecord(mark) || typeof mark.type !== 'string' || !MARKS.has(mark.type)) continue;
    if (mark.type === 'link') {
      const href = isRecord(mark.attrs) && typeof mark.attrs.href === 'string' ? mark.attrs.href.trim() : '';
      if (!SAFE_URL.test(href) || href.length > 2_048) continue;
      marks.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } });
      continue;
    }
    marks.push({ type: mark.type });
  }
  return marks.length > 0 ? marks : undefined;
}

function sanitizeAttrs(
  type: string,
  raw: unknown,
  state: SanitizeState,
): Record<string, unknown> | undefined {
  const attrs = isRecord(raw) ? raw : {};
  switch (type) {
    case 'heading': {
      const level = Number(attrs.level);
      return { level: level >= 1 && level <= 3 ? Math.trunc(level) : 2 };
    }
    case 'orderedList': {
      const start = Number(attrs.start);
      return { start: Number.isInteger(start) && start > 0 && start < 100_000 ? start : 1 };
    }
    case 'codeBlock':
      return typeof attrs.language === 'string' && /^[a-z0-9+#-]{1,20}$/i.test(attrs.language)
        ? { language: attrs.language }
        : undefined;
    case 'taskItem':
      return { checked: attrs.checked === true };
    case 'mention': {
      const id = typeof attrs.id === 'string' && UUID.test(attrs.id) ? attrs.id : null;
      if (!id) return undefined;
      state.mentions.add(id);
      const label = typeof attrs.label === 'string' ? attrs.label.slice(0, 120) : null;
      return { id, label };
    }
    default:
      return undefined;
  }
}

function sanitizeNode(raw: unknown, depth: number, state: SanitizeState): JsonNode | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) {
    throw new ValidationError([{ path: 'body', message: 'The update is too large or too deeply nested' }]);
  }
  const type = raw.type;
  if (type === 'text') {
    if (typeof raw.text !== 'string' || raw.text.length === 0) return null;
    state.textChars += raw.text.length;
    if (state.textChars > MAX_TEXT_CHARS) {
      throw new ValidationError([
        { path: 'body', message: `Updates are limited to ${MAX_TEXT_CHARS} characters` },
      ]);
    }
    state.text.push(raw.text);
    const marks = sanitizeMarks(raw.marks);
    return marks ? { type, text: raw.text, marks } : { type, text: raw.text };
  }
  if (!BLOCK_NODES.has(type) && !INLINE_NODES.has(type)) return null;
  if (type === 'hardBreak') {
    state.text.push('\n');
    return { type };
  }
  if (type === 'horizontalRule') return { type };
  const attrs = sanitizeAttrs(type, raw.attrs, state);
  if (type === 'mention') {
    if (!attrs) return null;
    state.text.push(`@${String(attrs.label ?? '')}`);
    return { type, attrs };
  }
  const content = Array.isArray(raw.content)
    ? raw.content
        .map((child) => sanitizeNode(child, depth + 1, state))
        .filter((child): child is JsonNode => child !== null)
    : [];
  if (BLOCK_NODES.has(type)) state.text.push('\n');
  const node: JsonNode = { type };
  if (attrs) node.attrs = attrs;
  if (content.length > 0) node.content = content;
  return node;
}

export interface SanitizedRichText {
  readonly doc: RichTextDoc;
  readonly text: string;
  readonly mentionedUserIds: string[];
}

export function sanitizeRichText(input: unknown): SanitizedRichText {
  const state: SanitizeState = { nodes: 0, textChars: 0, text: [], mentions: new Set() };
  const rawContent = isRecord(input) && Array.isArray(input.content) ? input.content : [];
  const content = rawContent
    .map((child) => sanitizeNode(child, 1, state))
    .filter((child): child is JsonNode => child !== null);
  const text = state.text
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { doc: { type: 'doc', content }, text, mentionedUserIds: [...state.mentions] };
}

/** Build a doc from plain text (paragraph per line). */
export function plainTextToDoc(text: string): RichTextDoc {
  return {
    type: 'doc',
    content: text
      .split(/\r?\n/)
      .map((line) =>
        line.length > 0
          ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
          : { type: 'paragraph' },
      ),
  };
}
