/**
 * One layout for every KitStak email (docs/billing/SPEC.md section 10). A template returns plain
 * content blocks. This file turns the same blocks into the HTML version and the text version, so the
 * two can never say different things.
 *
 * The HTML is table based with inline styles, because mail clients drop most CSS. It carries no
 * image and no tracking pixel, so nothing is blocked and nothing is tracked. The colors are the
 * KitStak brand colors from packages/ui (tokens.css), written as hex because a mail client cannot
 * read CSS variables.
 */

export type EmailBlock =
  /** One short paragraph. */
  | { readonly kind: 'text'; readonly text: string }
  /** A 6 digit code in large type. */
  | { readonly kind: 'code'; readonly code: string }
  /** Label and value rows, for example "Free until" and a date. */
  | { readonly kind: 'facts'; readonly rows: readonly { readonly label: string; readonly value: string }[] }
  /** Money lines with a total row, for a receipt. */
  | {
      readonly kind: 'lines';
      readonly rows: readonly { readonly label: string; readonly amount: string }[];
      readonly total: { readonly label: string; readonly amount: string };
    }
  /** A quiet closing line. */
  | { readonly kind: 'note'; readonly text: string };

export interface EmailButton {
  readonly label: string;
  readonly url: string;
}

export interface EmailContent {
  readonly subject: string;
  /** The preview line a mail client shows after the subject. */
  readonly preheader: string;
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  /** At most one button per email. */
  readonly button: EmailButton | null;
  /** Why this person got the email. */
  readonly footer: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const COLOR = {
  page: '#f7f5ef',
  card: '#ffffff',
  border: '#dcd6c8',
  borderSoft: '#e9e4d8',
  ink: '#0a1628',
  body: '#3c4659',
  muted: '#566072',
  sunken: '#f7f5ef',
  red: '#c8102e',
  oxblood: '#8f122c',
  white: '#ffffff',
} as const;

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A subject is one line. Line breaks in a name can never add a mail header. */
export function oneLine(value: string): string {
  return value.replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Only http and https links are ever put behind a button. */
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function blockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case 'text':
      return `<p class="ks-body" style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${COLOR.body};">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p class="ks-muted" style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${COLOR.muted};">${escapeHtml(block.text)}</p>`;
    case 'code':
      return [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">`,
        `<tr><td class="ks-sunken" align="center" style="padding:18px 12px;background-color:${COLOR.sunken};border:1px solid ${COLOR.borderSoft};border-radius:10px;">`,
        `<span class="ks-ink" style="font-family:${MONO};font-size:34px;line-height:40px;font-weight:700;letter-spacing:8px;color:${COLOR.ink};">${escapeHtml(block.code)}</span>`,
        `</td></tr></table>`,
      ].join('');
    case 'facts':
      return [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="ks-sunken" style="margin:0 0 16px;background-color:${COLOR.sunken};border:1px solid ${COLOR.borderSoft};border-radius:10px;">`,
        ...block.rows.map((row, index) => {
          const top = index === 0 ? '' : `border-top:1px solid ${COLOR.borderSoft};`;
          return [
            `<tr>`,
            `<td class="ks-muted ks-rule" valign="top" style="padding:11px 14px;${top}font-family:${FONT};font-size:14px;line-height:20px;color:${COLOR.muted};">${escapeHtml(row.label)}</td>`,
            `<td class="ks-ink ks-rule" valign="top" align="right" style="padding:11px 14px;${top}font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${COLOR.ink};">${escapeHtml(row.value)}</td>`,
            `</tr>`,
          ].join('');
        }),
        `</table>`,
      ].join('');
    case 'lines':
      return [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">`,
        ...block.rows.map((row) =>
          [
            `<tr>`,
            `<td class="ks-body ks-rule" valign="top" style="padding:9px 0;border-bottom:1px solid ${COLOR.borderSoft};font-family:${FONT};font-size:14px;line-height:20px;color:${COLOR.body};">${escapeHtml(row.label)}</td>`,
            `<td class="ks-ink ks-rule" valign="top" align="right" style="padding:9px 0 9px 16px;border-bottom:1px solid ${COLOR.borderSoft};font-family:${FONT};font-size:14px;line-height:20px;color:${COLOR.ink};white-space:nowrap;">${escapeHtml(row.amount)}</td>`,
            `</tr>`,
          ].join(''),
        ),
        `<tr>`,
        `<td class="ks-ink" valign="top" style="padding:12px 0 0;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${COLOR.ink};">${escapeHtml(block.total.label)}</td>`,
        `<td class="ks-ink" valign="top" align="right" style="padding:12px 0 0 16px;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:${COLOR.ink};white-space:nowrap;">${escapeHtml(block.total.amount)}</td>`,
        `</tr>`,
        `</table>`,
      ].join('');
  }
}

function buttonHtml(button: EmailButton): string {
  const url = safeUrl(button.url);
  if (!url) return '';
  const href = escapeHtml(url);
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">`,
    `<tr><td align="center" bgcolor="${COLOR.red}" style="border-radius:8px;background-color:${COLOR.red};">`,
    `<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:${COLOR.white};text-decoration:none;border-radius:8px;">${escapeHtml(button.label)}</a>`,
    `</td></tr></table>`,
    `<p class="ks-muted" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:19px;color:${COLOR.muted};">If the button does not work, copy this link into your browser:<br><a href="${href}" target="_blank" rel="noopener" class="ks-muted" style="color:${COLOR.muted};text-decoration:underline;word-break:break-all;">${href}</a></p>`,
  ].join('');
}

/** The two bar KitStak mark and the word, built from table cells so no image is needed. */
function logoHtml(): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td valign="middle" style="padding-right:10px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">`,
    `<tr><td width="26" height="6" bgcolor="${COLOR.red}" style="width:26px;height:6px;line-height:6px;font-size:0;background-color:${COLOR.red};">&nbsp;</td></tr>`,
    `<tr><td width="26" height="4" style="width:26px;height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`,
    `<tr><td width="26" height="6" bgcolor="${COLOR.oxblood}" style="width:26px;height:6px;line-height:6px;font-size:0;background-color:${COLOR.oxblood};">&nbsp;</td></tr>`,
    `</table>`,
    `</td>`,
    `<td valign="middle" class="ks-ink" style="font-family:${FONT};font-size:18px;line-height:22px;font-weight:800;letter-spacing:3px;color:${COLOR.ink};">KITSTAK</td>`,
    `</tr></table>`,
  ].join('');
}

/** Dark mode for the mail clients that honor it. The inline light colors are the fallback. */
const DARK_STYLES = [
  `:root{color-scheme:light dark;supported-color-schemes:light dark;}`,
  `@media (prefers-color-scheme: dark){`,
  `.ks-page{background-color:#0d0e10 !important;}`,
  `.ks-card{background-color:#141518 !important;border-color:#2c3036 !important;}`,
  `.ks-sunken{background-color:#1b1d21 !important;border-color:#23262b !important;}`,
  `.ks-ink{color:#ecedef !important;}`,
  `.ks-body{color:#b4b8bf !important;}`,
  `.ks-muted{color:#8a9099 !important;}`,
  `.ks-rule{border-color:#23262b !important;}`,
  `}`,
  `@media only screen and (max-width: 620px){.ks-card-pad{padding:24px 20px !important;}}`,
].join('');

export function renderHtml(content: EmailContent): string {
  const title = escapeHtml(oneLine(content.subject));
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="color-scheme" content="light dark">`,
    `<meta name="supported-color-schemes" content="light dark">`,
    `<title>${title}</title>`,
    `<style>${DARK_STYLES}</style>`,
    `</head>`,
    `<body class="ks-page" style="margin:0;padding:0;background-color:${COLOR.page};">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(content.preheader)}</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="ks-page" style="background-color:${COLOR.page};">`,
    `<tr><td align="center" style="padding:32px 12px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">`,
    `<tr><td style="padding:0 4px 20px;">${logoHtml()}</td></tr>`,
    `<tr><td class="ks-card ks-card-pad" style="padding:32px;background-color:${COLOR.card};border:1px solid ${COLOR.border};border-radius:14px;">`,
    `<h1 class="ks-ink" style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.3px;color:${COLOR.ink};">${escapeHtml(content.heading)}</h1>`,
    ...content.blocks.map(blockHtml),
    content.button ? buttonHtml(content.button) : '',
    `</td></tr>`,
    `<tr><td class="ks-muted" style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">${escapeHtml(content.footer)}<br>KitStak. One account for every KitStak app.</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join('\n');
}

function blockText(block: EmailBlock): string {
  switch (block.kind) {
    case 'text':
    case 'note':
      return block.text;
    case 'code':
      return `    ${block.code}`;
    case 'facts':
      return block.rows.map((row) => `${row.label}: ${row.value}`).join('\n');
    case 'lines':
      return [
        ...block.rows.map((row) => `${row.label}: ${row.amount}`),
        `${block.total.label}: ${block.total.amount}`,
      ].join('\n');
  }
}

export function renderText(content: EmailContent): string {
  const parts: string[] = [content.heading, ...content.blocks.map(blockText)];
  if (content.button) {
    const url = safeUrl(content.button.url);
    if (url) parts.push(`${content.button.label}:\n${url}`);
  }
  parts.push(`${content.footer}\nKitStak. One account for every KitStak app.`);
  return `${parts.join('\n\n')}\n`;
}

export function renderContent(content: EmailContent): RenderedEmail {
  return { subject: oneLine(content.subject), html: renderHtml(content), text: renderText(content) };
}
