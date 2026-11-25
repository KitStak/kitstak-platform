/**
 * The small Markdown dialect the docs use (content/docs/README.md). Pure: text in, blocks out, so
 * the page renders as plain server HTML and the test suite can check every page.
 */

export type DocBlock =
  | { readonly type: 'h2' | 'h3'; readonly text: string; readonly id: string }
  | { readonly type: 'p'; readonly text: string }
  | { readonly type: 'ul' | 'ol'; readonly items: readonly string[] }
  | {
      readonly type: 'table';
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: 'callout'; readonly kind: CalloutKind; readonly text: string }
  | { readonly type: 'code'; readonly lang: string; readonly code: string };

export type CalloutKind = 'note' | 'tip' | 'important';

export interface FrontMatter {
  readonly [key: string]: string;
}

/** Splits `---` front matter from the body. Values are plain strings, quotes trimmed. */
export function splitFrontMatter(source: string): { readonly data: FrontMatter; readonly body: string } {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const value = (pair[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
    data[pair[1] as string] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

/** "Receive a purchase order" to "receive-a-purchase-order". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/\*\*|`/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

/** Removes the inline marks, for plain text (search, word counts, descriptions). */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2');
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+/;
const CALLOUT = /^\*\*(Note|Tip|Important|Warning):?\*\*:?\s*/i;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string | undefined): boolean {
  return line !== undefined && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

export function parseMarkdown(body: string): DocBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocBlock[] = [];
  const ids = new Map<string, number>();
  const uniqueId = (text: string): string => {
    const base = slugify(text);
    const seen = ids.get(base) ?? 0;
    ids.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      i += 1;
      continue;
    }

    const fence = /^```\s*([\w-]*)/.exec(trimmed);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', lang: fence[1] ?? '', code: code.join('\n') });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    if (heading) {
      const level = (heading[1] ?? '').length;
      const text = heading[2] ?? '';
      // The page title is the only h1, so a stray "#" becomes an h2, and anything deeper an h3.
      const type = level <= 2 ? 'h2' : 'h3';
      blocks.push({ type, text, id: uniqueId(text) });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('|') && isTableSeparator(lines[i + 1])) {
      const head = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const row = splitRow(lines[i] ?? '');
        while (row.length < head.length) row.push('');
        rows.push(row.slice(0, head.length));
        i += 1;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        parts.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      let text = parts.join(' ').trim();
      const label = CALLOUT.exec(text);
      let kind: CalloutKind = 'note';
      if (label) {
        const word = (label[1] ?? '').toLowerCase();
        kind = word === 'tip' ? 'tip' : word === 'important' || word === 'warning' ? 'important' : 'note';
        text = text.slice(label[0].length);
      }
      blocks.push({ type: 'callout', kind, text });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const ordered = ORDERED.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const item = LIST_ITEM.exec(current);
        if (item) {
          items.push((item[1] ?? '').trim());
        } else if (current.trim() !== '' && /^\s{2,}\S/.test(current) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1]} ${current.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      const t = current.trim();
      if (
        t === '' ||
        t.startsWith('#') ||
        t.startsWith('```') ||
        t.startsWith('>') ||
        LIST_ITEM.test(current)
      )
        break;
      if (t.startsWith('|') && isTableSeparator(lines[i + 1])) break;
      para.push(t);
      i += 1;
    }
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}
