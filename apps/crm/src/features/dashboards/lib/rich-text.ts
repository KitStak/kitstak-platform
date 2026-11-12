/**
 * Tiny, safe markdown subset for Text widgets: `# heading`, `- bullets`, paragraphs, `**bold**`,
 * `_italic_` and `[links](https://…)`. Produces plain data (rendered as React nodes, never HTML).
 */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'italic'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type Block =
  | { readonly kind: 'heading'; readonly inline: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[] };

const INLINE = /\*\*([^*]+)\*\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  return null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1]) out.push({ kind: 'bold', text: match[1] });
    else if (match[2]) out.push({ kind: 'italic', text: match[2] });
    else if (match[3] && match[4]) {
      const href = safeHref(match[4]);
      out.push(href ? { kind: 'link', text: match[3], href } : { kind: 'text', text: match[3] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let list: Inline[][] | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', items: list });
    list = null;
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
    } else if (/^#{1,3}\s+/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', inline: parseInline(line.replace(/^#{1,3}\s+/, '')) });
    } else if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      list = [...(list ?? []), parseInline(line.replace(/^[-*]\s+/, ''))];
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Time left until `target`, broken into units (all zero once passed). */
export function countdownParts(target: Date, now: Date): { past: boolean; days: number; hours: number; minutes: number; seconds: number } {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return { past: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const seconds = Math.floor(diff / 1000);
  return {
    past: false,
    days: Math.floor(seconds / 86_400),
    hours: Math.floor((seconds % 86_400) / 3_600),
    minutes: Math.floor((seconds % 3_600) / 60),
    seconds: seconds % 60,
  };
}
