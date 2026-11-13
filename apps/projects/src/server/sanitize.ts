/**
 * Rich-text sanitizer for task/project/goal descriptions (HTML from the Tiptap editor).
 * Allow-list only: formatting, lists, task lists, links (http/https/mailto), code, quotes,
 * mentions (`span[data-type=mention][data-id]`). Everything else is stripped.
 */
import 'server-only';
import DOMPurify from 'isomorphic-dompurify';

const MAX_HTML_CHARS = 200_000;

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'pre', 'blockquote',
  'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'hr', 'span', 'mark', 'label', 'input', 'div',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'data-type', 'data-id', 'data-label', 'data-checked', 'type', 'checked', 'class', 'start'];

let hooked = false;

function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (node.tagName === 'INPUT' && node.getAttribute('type') !== 'checkbox') node.remove();
  });
}

/** Sanitized HTML, or null when the document is empty. */
export function sanitizeRichText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;
  const input = html.slice(0, MAX_HTML_CHARS);
  ensureHooks();
  const clean = DOMPurify.sanitize(input, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
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
