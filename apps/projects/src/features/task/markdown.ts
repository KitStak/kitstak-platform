/**
 * Tiny, safe markdown parser for comments (no HTML ever passes through): paragraphs, line
 * breaks, bullet / numbered / check lists, quotes, fenced code, headings, and inline bold,
 * italic, strike, code, links (http/https/mailto only), bare URLs and @mention tokens.
 * Rendering lives in markdown-view.tsx.
 */

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'mention'; readonly name: string; readonly id: string }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly type: 'strong' | 'em' | 'del'; readonly children: readonly Inline[] };

export interface ListItem {
  readonly text: string;
  /** null = plain bullet; true/false = checklist item. */
  readonly checked: boolean | null;
}

export type Block =
  | { readonly type: 'p'; readonly text: string }
  | { readonly type: 'h'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: 'ul'; readonly items: readonly ListItem[] }
  | { readonly type: 'ol'; readonly start: number; readonly items: readonly ListItem[] }
  | { readonly type: 'quote'; readonly text: string }
  | { readonly type: 'code'; readonly text: string; readonly lang: string };

const BULLET = /^\s*[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const NUMBERED = /^\s*(\d{1,6})[.)]\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence (or end)
      blocks.push({ type: 'code', text: body.join('\n'), lang: fence[1] ?? '' });
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        body.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }
    if (BULLET.test(line)) {
      const items: ListItem[] = [];
      while (index < lines.length && BULLET.test(lines[index])) {
        const match = BULLET.exec(lines[index])!;
        items.push({
          text: match[2],
          checked: match[1] === undefined ? null : match[1].toLowerCase() === 'x',
        });
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (NUMBERED.test(line)) {
      const items: ListItem[] = [];
      const start = Number(NUMBERED.exec(line)![1]);
      while (index < lines.length && NUMBERED.test(lines[index])) {
        items.push({ text: NUMBERED.exec(lines[index])![2], checked: null });
        index += 1;
      }
      blocks.push({ type: 'ol', start, items });
      continue;
    }
    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^#{1,3}\s/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !BULLET.test(lines[index]) &&
      !NUMBERED.test(lines[index])
    ) {
      body.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'p', text: body.join('\n') });
  }
  return blocks;
}

/** Only these link targets are rendered as links. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return null;
}

const INLINE = new RegExp(
  [
    String.raw`@\[([^\]\n]{1,80})\]\(user:([0-9a-fA-F-]{36})\)`, // 1,2 mention
    String.raw`\x60([^\x60\n]+)\x60`, // 3 code
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`, // 4,5 link
    String.raw`\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*`, // 6 bold
    String.raw`~~([^~\n]+)~~`, // 7 strike
    String.raw`(?<![\w*])\*([^*\n\s](?:[^*\n]*[^*\n\s])?)\*(?!\*)`, // 8 italic *
    String.raw`(?<![\w])_([^_\n\s](?:[^_\n]*[^_\n\s])?)_(?![\w])`, // 9 italic _
    String.raw`(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])`, // 10 bare url
  ].join('|'),
  'g',
);

export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text') out[out.length - 1] = { type: 'text', text: prev.text + value };
    else out.push({ type: 'text', text: value });
  };
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    push(text.slice(last, index));
    last = index + match[0].length;
    const nested = (value: string) =>
      depth > 4 ? [{ type: 'text', text: value } as Inline] : parseInline(value, depth + 1);
    if (match[1] !== undefined) out.push({ type: 'mention', name: match[1], id: match[2].toLowerCase() });
    else if (match[3] !== undefined) out.push({ type: 'code', text: match[3] });
    else if (match[4] !== undefined) {
      const href = safeHref(match[5]);
      if (href) out.push({ type: 'link', href, children: nested(match[4]) });
      else push(match[0]);
    } else if (match[6] !== undefined) out.push({ type: 'strong', children: nested(match[6]) });
    else if (match[7] !== undefined) out.push({ type: 'del', children: nested(match[7]) });
    else if (match[8] !== undefined) out.push({ type: 'em', children: nested(match[8]) });
    else if (match[9] !== undefined) out.push({ type: 'em', children: nested(match[9]) });
    else if (match[10] !== undefined)
      out.push({ type: 'link', href: match[10], children: [{ type: 'text', text: match[10] }] });
  }
  push(text.slice(last));
  return out;
}
