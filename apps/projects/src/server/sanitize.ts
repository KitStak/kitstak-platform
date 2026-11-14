/**
 * Rich-text sanitizer for task/project/goal descriptions (HTML from the Tiptap editor).
 * Allow-list only: formatting, lists, task lists, links (http/https/mailto), code, quotes,
 * mentions (`span[data-type=mention][data-id]`). Everything else is stripped.
 */
import 'server-only';
import sanitizeHtml from 'sanitize-html';

const MAX_HTML_CHARS = 200_000;

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'hr', 'span', 'mark', 'label', 'input', 'div',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'data-type', 'data-id', 'data-label', 'data-checked', 'type', 'checked', 'class', 'start'];

// Pure-JS parser (htmlparser2): no jsdom, so it loads in any serverless runtime.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { '*': ALLOWED_ATTR },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => {
      const next: Record<string, string> = { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' };
      if (!/^(https?:|mailto:)/i.test(attribs.href ?? '')) delete next.href;
      return { tagName, attribs: next };
    },
  },
  // Only task-list checkboxes survive as inputs.
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
};

/** Sanitized HTML, or null when the document is empty. */
export function sanitizeRichText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  const clean = sanitizeHtml(html.slice(0, MAX_HTML_CHARS), OPTIONS);
  const textOnly = clean.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (textOnly.length === 0 && !/<(hr|input)\b/i.test(clean)) return null;
  return clean;
}

/** Plain text of rich HTML (previews, notifications). */
export function richTextToPlain(html: string | null | undefined, max = 280): string {
  if (!html) return '';
  const text = html
    .replace(/<(br|\/p|\/li|\/h[1-3])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
