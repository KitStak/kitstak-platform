/**
 * Rich-text (Tiptap/ProseMirror JSON) helpers for updates. The server sanitizes every doc; the
 * client renders it through a React tree (never HTML strings), using these guards again so a
 * malformed or legacy doc can never produce unsafe output.
 */

export interface RichNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly RichNode[];
  readonly text?: string;
  readonly marks?: readonly { readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }[];
}

export interface RichDoc {
  readonly type: 'doc';
  readonly content?: readonly unknown[];
}

const SAFE_URL = /^(https?:|mailto:)/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRichNode(value: unknown): value is RichNode {
  return isRecord(value) && typeof value.type === 'string';
}

export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  return SAFE_URL.test(href) && href.length <= 2_048 ? href : null;
}

/** Plain text of a doc (mentions as "@Name"). */
export function docText(doc: RichDoc | null | undefined): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!isRichNode(node)) return;
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
    else if (node.type === 'mention') out.push(`@${String(node.attrs?.label ?? '')}`);
    else if (node.type === 'hardBreak') out.push('\n');
    node.content?.forEach(walk);
    if (node.type === 'paragraph' || node.type === 'listItem' || node.type === 'taskItem') out.push('\n');
  };
  doc?.content?.forEach(walk);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export function mentionIds(doc: RichDoc | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (node: unknown) => {
    if (!isRichNode(node)) return;
    if (node.type === 'mention' && typeof node.attrs?.id === 'string') ids.add(node.attrs.id);
    node.content?.forEach(walk);
  };
  doc?.content?.forEach(walk);
  return [...ids];
}

/** True when the doc has no text and no mentions (only empty paragraphs / whitespace). */
export function isDocEmpty(doc: RichDoc | null | undefined): boolean {
  return docText(doc).length === 0 && mentionIds(doc).length === 0;
}

export function paragraphDoc(text: string): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/** Body for an update that only carries attachments (the API requires some text). */
export function attachmentOnlyDoc(fileCount: number): RichDoc {
  return paragraphDoc(fileCount === 1 ? 'Shared a file' : `Shared ${fileCount} files`);
}
