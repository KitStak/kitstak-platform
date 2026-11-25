/**
 * One layout for every KitStak email (docs/billing/SPEC.md section 10). A template returns plain
 * content blocks. This file turns the same blocks into the HTML version and the text version, so the
 * two can never say different things.
 *
 * The HTML is table based with inline styles, because mail clients drop most CSS. Its one image is
 * the KitStak lockup artwork from kitstak.com (alt "KitStak" where images are blocked); there is no
 * tracking pixel and no per-recipient link, so nothing is tracked. The display face is Bebas Neue,
 * also from kitstak.com, where a client loads web fonts, else a narrow system face. The colors are the
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

/**
 * The look of one kind of email. Every email shares the layout; the tone sets the accent edge on
 * the card and the small label over the heading, so each kind reads at a glance:
 *   security  codes and password resets         navy
 *   welcome   invites and a new trial           KitStak red
 *   reminder  trial countdowns                  amber
 *   receipt   a plan confirmed, a payment made  green
 *   alert     a payment that needs the reader   danger red, first paragraph in bold red
 *   notice    a plan canceled, paused or ended  slate blue
 */
export type EmailTone = 'security' | 'welcome' | 'reminder' | 'receipt' | 'alert' | 'notice';

/** How one email is dressed. Templates leave it out; `renderEmail` adds it per template. */
export interface EmailStyle {
  readonly tone: EmailTone;
  /** The small label over the heading, for example "Receipt" or "3 days left". */
  readonly eyebrow: string;
  /** The part of KitStak in the header lockup: KITSTAK | ACCOUNT. */
  readonly area: string;
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
  /** Tone, label and header area. Without it the email uses the plain KitStak look. */
  readonly style?: EmailStyle;
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
  white: '#ffffff',
  navy: '#0a1628',
  cream: '#f4f1e9',
  product: '#596274',
  divider: '#cfd2d8',
} as const;

/**
 * Tone colors from packages/ui tokens.css: `edge` is the accent bar on the card, `text` the label and the
 * alert line (AA readable on white), `darkText` the same in dark mode.
 */
const TONE: Readonly<Record<EmailTone, { edge: string; text: string; darkText: string }>> = {
  security: { edge: '#0a1628', text: '#0a1628', darkText: '#ecedef' },
  welcome: { edge: '#c8102e', text: '#8f122c', darkText: '#ff8b9c' },
  reminder: { edge: '#f5b13d', text: '#8f4b04', darkText: '#f5b968' },
  receipt: { edge: '#0e8a52', text: '#0b6e41', darkText: '#5fd39b' },
  alert: { edge: '#b3112c', text: '#a30e27', darkText: '#ff8b9c' },
  notice: { edge: '#2d5c94', text: '#244d7f', darkText: '#8db7ec' },
};

const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** The brand display face (Bebas Neue) where a mail client has it, else a narrow system face. */
const DISPLAY = "'Bebas Neue', 'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif";
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
  return value
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

/** The alert tone's first paragraph: the thing to act on, as bold text in the alert color. */
function calloutHtml(text: string): string {
  return `<p class="ks-tint-alert-text" style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;font-weight:600;color:${TONE.alert.text};">${escapeHtml(text)}</p>`;
}

function blockHtml(block: EmailBlock, callout = false): string {
  switch (block.kind) {
    case 'text':
      if (callout) return calloutHtml(block.text);
      return `<p class="ks-body" style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${COLOR.body};">${escapeHtml(block.text)}</p>`;
    case 'note':
      return `<p class="ks-muted" style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${COLOR.muted};">${escapeHtml(block.text)}</p>`;
    case 'code':
      return [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">`,
        `<tr><td class="ks-code" align="center" bgcolor="${COLOR.navy}" style="padding:22px 12px 20px;background-color:${COLOR.navy};border-radius:12px;">`,
        `<span style="font-family:${MONO};font-size:36px;line-height:42px;font-weight:700;letter-spacing:10px;color:${COLOR.cream};">${escapeHtml(block.code)}</span>`,
        `<br><span style="font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9aa3b2;">Do not share this code</span>`,
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

/**
 * The supplied KitStak lockup artwork (bars and wordtype), served by the marketing site. Navy
 * wordtype on light, cream on dark. 1200 x 228 source, shown at LOGO_WIDTH.
 */
export const BRAND_ASSET_ORIGIN = 'https://kitstak.com';
const LOGO = {
  light: `${BRAND_ASSET_ORIGIN}/brand/kitstak-lockup-navy.png`,
  dark: `${BRAND_ASSET_ORIGIN}/brand/kitstak-lockup-cream.png`,
  width: 126,
  height: 24,
} as const;

function logoImg(src: string, className: string, hidden: boolean): string {
  const img = `<img src="${src}" width="${LOGO.width}" height="${LOGO.height}" alt="KitStak" style="display:block;width:${LOGO.width}px;height:${LOGO.height}px;border:0;outline:none;text-decoration:none;font-family:${FONT};font-size:16px;font-weight:700;color:${COLOR.ink};">`;
  // The dark copy is hidden everywhere (Outlook included) until dark mode shows it.
  return hidden
    ? `<!--[if !mso]><!--><div class="${className}" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${img}</div><!--<![endif]-->`
    : `<div class="${className}">${img}</div>`;
}

/**
 * The KitStak lockup as the apps draw it (packages/ui Logo): the supplied artwork, then a divider
 * and the part of KitStak the email is from, in the app header's product label style.
 */
function logoHtml(area?: string): string {
  const areaCells = area
    ? [
        `<td valign="middle" style="padding:0 10px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="1" height="${LOGO.height}" class="ks-divider" bgcolor="${COLOR.divider}" style="width:1px;height:${LOGO.height}px;line-height:${LOGO.height}px;font-size:0;background-color:${COLOR.divider};">&nbsp;</td></tr></table></td>`,
        `<td valign="middle" class="ks-product" style="font-family:${FONT};font-size:13px;line-height:${LOGO.height}px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${COLOR.product};">${escapeHtml(area)}</td>`,
      ]
    : [];
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td valign="middle">${logoImg(LOGO.light, 'ks-logo-light', false)}${logoImg(LOGO.dark, 'ks-logo-dark', true)}</td>`,
    ...areaCells,
    `</tr></table>`,
  ].join('');
}

/** The tone's small label over the heading. */
function eyebrowHtml(style: EmailStyle): string {
  const tone = TONE[style.tone];
  return `<p class="ks-tint-${style.tone}-text" style="margin:0 0 8px;font-family:${DISPLAY};font-size:16px;line-height:18px;letter-spacing:1.5px;text-transform:uppercase;color:${tone.text};">${escapeHtml(style.eyebrow)}</p>`;
}

/** Dark mode text colors, one rule per tone. */
const TONE_DARK = (Object.keys(TONE) as EmailTone[])
  .map((tone) => `.ks-tint-${tone}-text{color:${TONE[tone].darkText} !important;}`)
  .join('');

/** Dark mode for the mail clients that honor it. The inline light colors are the fallback. */
const DARK_STYLES = [
  // The brand display face for the clients that load web fonts (Apple Mail, iOS, Outlook for Mac).
  `@font-face{font-family:'Bebas Neue';font-style:normal;font-weight:400;font-display:swap;src:url('${BRAND_ASSET_ORIGIN}/fonts/BebasNeue-Regular.woff2') format('woff2');}`,
  `:root{color-scheme:light dark;supported-color-schemes:light dark;}`,
  `@media (prefers-color-scheme: dark){`,
  `.ks-page{background-color:#0d0e10 !important;}`,
  `.ks-card{background-color:#141518 !important;border-color:#2c3036 !important;}`,
  `.ks-sunken{background-color:#1b1d21 !important;border-color:#23262b !important;}`,
  `.ks-ink{color:#ecedef !important;}`,
  `.ks-body{color:#b4b8bf !important;}`,
  `.ks-muted{color:#8a9099 !important;}`,
  `.ks-rule{border-color:#23262b !important;}`,
  `.ks-code{background-color:#1b2232 !important;}`,
  `.ks-divider{background-color:#3a3f47 !important;}`,
  `.ks-product{color:#9aa3b2 !important;}`,
  `.ks-logo-light{display:none !important;}`,
  `.ks-logo-dark{display:block !important;max-height:none !important;overflow:visible !important;}`,
  TONE_DARK,
  `}`,
  `@media only screen and (max-width: 620px){.ks-card-pad{padding:24px 20px !important;}}`,
].join('');

export function renderHtml(content: EmailContent): string {
  const title = escapeHtml(oneLine(content.subject));
  const style = content.style;
  // An alert sets its first paragraph, the thing to act on, in bold alert red.
  const callout = style?.tone === 'alert' ? content.blocks.findIndex((block) => block.kind === 'text') : -1;
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
    `<tr><td style="padding:0 4px 20px;">${logoHtml(style?.area)}</td></tr>`,
    // The tone's accent edge: a 4px bar across the top of the card.
    style
      ? `<tr><td height="4" bgcolor="${TONE[style.tone].edge}" style="height:4px;line-height:4px;font-size:0;background-color:${TONE[style.tone].edge};border-radius:14px 14px 0 0;">&nbsp;</td></tr>`
      : '',
    `<tr><td class="ks-card ks-card-pad" style="padding:32px;background-color:${COLOR.card};border:1px solid ${COLOR.border};${style ? 'border-top:0;border-radius:0 0 14px 14px;' : 'border-radius:14px;'}">`,
    style ? eyebrowHtml(style) : '',
    `<h1 class="ks-ink" style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.3px;color:${COLOR.ink};">${escapeHtml(content.heading)}</h1>`,
    ...content.blocks.map((block, index) => blockHtml(block, callout === index)),
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
