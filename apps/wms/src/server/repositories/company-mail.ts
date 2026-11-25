/**
 * Company outbound email (Company Settings › Email delivery, M14).
 *
 * - Settings live in `company_settings.defaults.mail`; the SMTP password is encrypted with the
 *   integration vault (AES-256-GCM) and never returned to the browser (only `••••last4`).
 * - Transport "log" means "no SMTP of our own": the message goes through KitStak's email service
 *   (Resend) when the platform has it set up, else to the server log (development). Transport "smtp" sends
 *   through the configured server with a small built-in SMTP client: implicit TLS (465),
 *   STARTTLS (587) or plain (25, local relays only), AUTH PLAIN / LOGIN.
 * - `sendCompanyMail` reports what actually happened, so callers (welcome email, test send)
 *   never claim a delivery that did not occur.
 */
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { eq, sql } from 'drizzle-orm';
import type { AppDb } from '@/server/api/db';
import { AppError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import * as s from '@/server/db/schema';
import { decryptCredentials, encryptCredentials } from '@/server/integrations/crypto';
import { log } from '@/server/log';
import { resendReady, sendWithResend } from '@kitstak/mail';
import { renderContent, type EmailContent } from '@kitstak/mail/layout';
import type {
  MailDelivery,
  MailSettingsInput,
  MailSettingsView,
  MailSecurity,
  MailTransport,
} from '@/lib/grid-defs/admin/company-mail';
import { assertVersion, domainCtxOf, logUpdate, type Actor } from './users-shared';
import { getBranding } from './apps-branding';

const c = s.companySettings;
const ID = 'company';

interface StoredMail {
  readonly transport: MailTransport;
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  readonly username: string;
  readonly fromAddress: string;
  readonly fromName: string;
  /** `encryptCredentials({ password })`. */
  readonly secret: string | null;
}

const EMPTY: StoredMail = {
  transport: 'log',
  host: '',
  port: 587,
  security: 'starttls',
  username: '',
  fromAddress: '',
  fromName: '',
  secret: null,
};

async function rowDefaults(db: AppDb): Promise<{ defaults: Record<string, unknown>; version: number }> {
  const row = (
    await db.select({ defaults: c.defaults, version: c.version }).from(c).where(eq(c.id, ID)).limit(1)
  )[0];
  return {
    defaults: (row?.defaults ?? {}) as unknown as Record<string, unknown>,
    version: row?.version ?? 1,
  };
}

async function readStored(db: AppDb): Promise<StoredMail> {
  const raw = (await rowDefaults(db)).defaults.mail;
  if (!raw || typeof raw !== 'object') return EMPTY;
  return { ...EMPTY, ...(raw as Partial<StoredMail>) };
}

function view(m: StoredMail, version: number): MailSettingsView {
  const password = decryptCredentials(m.secret)?.password ?? '';
  return {
    transport: m.transport,
    host: m.host,
    port: m.port,
    security: m.security,
    username: m.username,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    passwordSet: password.length > 0,
    passwordHint: password ? password.slice(-2) : null,
    ready: m.transport === 'smtp' && Boolean(m.host && m.fromAddress),
    platformMail: resendReady(),
    version,
  };
}

export async function getMailSettings(db: AppDb): Promise<MailSettingsView> {
  return view(await readStored(db), (await rowDefaults(db)).version);
}

export async function updateMailSettings(
  tx: AppDb,
  auth: AuthContext,
  actor: Actor,
  input: MailSettingsInput,
): Promise<MailSettingsView> {
  const { defaults, version } = await rowDefaults(tx);
  assertVersion(version, input.version);
  const before = await readStored(tx);
  const oldPassword = decryptCredentials(before.secret)?.password ?? '';
  const password = input.clearPassword ? '' : input.password?.trim() ? input.password : oldPassword;
  const next: StoredMail = {
    transport: input.transport,
    host: input.host.trim(),
    port: input.port,
    security: input.security,
    username: input.username.trim(),
    fromAddress: input.fromAddress.trim().toLowerCase(),
    fromName: input.fromName.trim(),
    secret: password ? encryptCredentials({ password }) : null,
  };
  if (next.transport === 'smtp' && (!next.host || !next.fromAddress)) {
    throw new AppError('VALIDATION', 'SMTP needs a server and a From address', {
      fieldErrors: {
        ...(next.host ? {} : { host: ['Required for SMTP'] }),
        ...(next.fromAddress ? {} : { fromAddress: ['Required for SMTP'] }),
      },
    });
  }
  await tx
    .update(c)
    .set({
      defaults: { ...defaults, mail: next } as unknown as typeof c.$inferInsert.defaults,
      updatedBy: actor.userId,
      updatedAt: new Date().toISOString(),
      version: sql`${c.version} + 1`,
    })
    .where(eq(c.id, ID));
  const shown = (m: StoredMail, pw: string) => ({
    emailDelivery: m.transport === 'smtp' ? 'SMTP server' : 'Server log only',
    smtpServer: m.host ? `${m.host}:${m.port}` : '',
    smtpSecurity: m.security,
    smtpUsername: m.username,
    fromAddress: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress,
    smtpPassword: pw ? 'Set' : 'Not set',
  });
  await logUpdate(
    tx,
    domainCtxOf(actor, auth),
    { entityType: 'company', entityId: ID, entityCode: 'Company settings' },
    shown(before, oldPassword),
    shown(next, password),
  );
  return await getMailSettings(tx);
}

/* ---------------- sending ---------------- */

export interface OutboundMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /**
   * The designed email (src/server/mail/templates.ts). When set, the subject, HTML and text are
   * rendered from it in the KitStak layout and `text` is only the fallback for an old caller.
   */
  readonly content?: EmailContent;
}

/** What actually goes out: plain text always, HTML when the mail was designed. */
interface RenderedMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/** Renders the designed email, or keeps plain text, and adds the company's branding footer. */
export function renderOutbound(input: OutboundMail, companyFooter?: string | null): RenderedMail {
  const footer = companyFooter?.trim() ? companyFooter.trim() : null;
  if (input.content) {
    const content = footer
      ? { ...input.content, footer: `${input.content.footer}\n${footer}` }
      : input.content;
    const rendered = renderContent(content);
    return { to: input.to, subject: rendered.subject, text: rendered.text, html: rendered.html };
  }
  return {
    to: input.to,
    subject: input.subject,
    text: footer ? `${input.text.trimEnd()}\n\n--\n${footer}\n` : input.text,
  };
}

export interface MailResult {
  /**
   * "smtp" = accepted by the company SMTP server; "resend" = accepted by KitStak's email service;
   * "log" = written to the server log only.
   */
  readonly transport: MailDelivery;
  readonly delivered: boolean;
}

const SMTP_TIMEOUT_MS = 15_000;

/** Line-buffered SMTP reply reader: resolves with the final line of each (multi-line) reply. */
class SmtpConversation {
  private buffer = '';
  private waiters: ((line: { code: number; text: string } | Error) => void)[] = [];
  private lines: string[] = [];
  constructor(private socket: Socket | TLSSocket) {
    this.attach(socket);
  }

  attach(socket: Socket | TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 2);
        this.lines.push(line);
        // "250-..." continues; "250 ..." ends the reply.
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), text: this.lines.join('\n') };
          this.lines = [];
          this.waiters.shift()?.(reply);
        }
      }
    });
    socket.on('error', (err) => {
      for (const w of this.waiters.splice(0)) w(err);
    });
  }

  reply(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) =>
      this.waiters.push((r) => (r instanceof Error ? reject(r) : resolve(r))),
    );
  }

  async send(
    command: string,
    expect: readonly number[],
    label = command.split(' ')[0] ?? 'command',
  ): Promise<string> {
    this.socket.write(`${command}\r\n`);
    return this.expect(expect, label);
  }

  async expect(expect: readonly number[], label: string): Promise<string> {
    const r = await this.reply();
    if (!expect.includes(r.code))
      throw new AppError(
        'INVALID_STATE',
        `The mail server rejected ${label}: ${r.text.split('\n').pop() ?? r.code}`,
      );
    return r.text;
  }
}

/** RFC 5322 header-safe text (no CR/LF injection). */
const headerSafe = (v: string): string => v.replace(/[\r\n]+/g, ' ').trim();

/**
 * A header value a mail server can carry: plain ASCII stays as it is; anything else (a company
 * called "Café") becomes RFC 2047 encoded words, each at most 75 characters, folded onto lines.
 */
export function encodeHeader(value: string): string {
  const safe = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  const words: string[] = [];
  let chunk = '';
  for (const char of safe) {
    // 45 UTF-8 bytes encode to 60 base64 characters, which keeps each word under 75.
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** CRLF line endings and SMTP dot-stuffing (a line that starts with "." gets a second one). */
function smtpText(text: string): string {
  return text
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((l) => (l.startsWith('.') ? `.${l}` : l))
    .join('\r\n');
}

/** Base64 in 76 character lines (RFC 2045). HTML lines are long; SMTP allows 998 at most. */
function base64Lines(value: string): string {
  return (
    Buffer.from(value, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');
}

export function buildMessage(
  from: { address: string; name: string },
  mail: RenderedMail,
  now = new Date(),
): string {
  const name = headerSafe(from.name).replace(/"/g, "'");
  const fromHeader = !name
    ? from.address
    : /^[\x20-\x7e]*$/.test(name)
      ? `"${name}" <${from.address}>`
      : `${encodeHeader(name)} <${from.address}>`;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${headerSafe(mail.to)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${now.getTime()}.${Math.random().toString(36).slice(2)}@${from.address.split('@')[1] ?? 'kitstaks.local'}>`,
    'MIME-Version: 1.0',
  ];
  if (!mail.html) {
    return [
      ...headers,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      smtpText(mail.text),
    ].join('\r\n');
  }
  // Text and HTML of the same email; a client shows the richest part it can.
  const boundary = `ks-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    smtpText(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.html),
    `--${boundary}--`,
  ].join('\r\n');
}

async function smtpSend(m: StoredMail, password: string, mail: RenderedMail): Promise<void> {
  const open = (): Promise<Socket | TLSSocket> =>
    new Promise((resolve, reject) => {
      const sock =
        m.security === 'tls'
          ? tlsConnect({ host: m.host, port: m.port, servername: m.host })
          : netConnect({ host: m.host, port: m.port });
      sock.setTimeout(SMTP_TIMEOUT_MS, () =>
        sock.destroy(new Error('The mail server did not answer in time')),
      );
      sock.once(m.security === 'tls' ? 'secureConnect' : 'connect', () => resolve(sock));
      sock.once('error', reject);
    });
  let socket = await open().catch((e: unknown) => {
    throw new AppError(
      'INVALID_STATE',
      `Couldn't reach ${m.host}:${m.port} (${e instanceof Error ? e.message : 'connection failed'})`,
    );
  });
  const smtp = new SmtpConversation(socket);
  try {
    await smtp.expect([220], 'the connection');
    const ehlo = await smtp.send('EHLO kitstaks.local', [250], 'EHLO');
    if (m.security === 'starttls') {
      if (!/STARTTLS/i.test(ehlo))
        throw new AppError(
          'INVALID_STATE',
          "The mail server doesn't offer STARTTLS. Choose SSL/TLS or None.",
        );
      await smtp.send('STARTTLS', [220]);
      socket.removeAllListeners('data');
      socket = await new Promise<TLSSocket>((resolve, reject) => {
        const secure = tlsConnect({ socket, servername: m.host }, () => resolve(secure));
        secure.once('error', reject);
      });
      smtp.attach(socket);
      await smtp.send('EHLO kitstaks.local', [250], 'EHLO');
    }
    if (m.username) {
      try {
        await smtp.send(
          `AUTH PLAIN ${Buffer.from(`\0${m.username}\0${password}`).toString('base64')}`,
          [235],
          'the user name or password',
        );
      } catch {
        await smtp.send('AUTH LOGIN', [334]);
        await smtp.send(Buffer.from(m.username).toString('base64'), [334], 'the user name');
        await smtp.send(Buffer.from(password).toString('base64'), [235], 'the password');
      }
    }
    await smtp.send(`MAIL FROM:<${m.fromAddress}>`, [250], 'the From address');
    await smtp.send(`RCPT TO:<${headerSafe(mail.to)}>`, [250, 251], 'the recipient');
    await smtp.send('DATA', [354]);
    await smtp.send(
      `${buildMessage({ address: m.fromAddress, name: m.fromName }, mail)}\r\n.`,
      [250],
      'the message',
    );
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}

/**
 * Sends through KitStak's own mail service (Resend, `@kitstak/mail`). A refused send throws, the
 * same as a refused SMTP send, so callers never report a delivery that did not happen.
 */
async function platformSend(mail: RenderedMail, replyTo: string): Promise<MailResult> {
  const result = await sendWithResend({
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    ...(replyTo ? { replyTo } : {}),
  });
  if (!result.ok) {
    log.warn('mail via KitStak email service failed', {
      component: 'mail',
      to: mail.to,
      subject: mail.subject,
      kind: result.kind,
      err: result.error,
    });
    throw new AppError('INVALID_STATE', `KitStak email could not send this message. ${result.error}`);
  }
  log.info('mail sent', { component: 'mail', to: mail.to, subject: mail.subject, via: 'resend' });
  return { transport: 'resend', delivered: true };
}

/**
 * Sends one email and reports what really happened. Order: the company's own SMTP server when
 * it is set up, else KitStak's email service when the platform has RESEND_API_KEY and
 * EMAIL_FROM, else the server log (development).
 */
export async function sendCompanyMail(db: AppDb, input: OutboundMail): Promise<MailResult> {
  const m = await readStored(db);
  const mail = renderOutbound(input, (await getBranding(db))?.emailFooter);
  const smtpReady = m.transport === 'smtp' && Boolean(m.host && m.fromAddress);
  if (!smtpReady && resendReady()) return platformSend(mail, m.fromAddress);
  if (!smtpReady) {
    log.info('mail (server log; email delivery not set up)', {
      component: 'mail',
      to: mail.to,
      subject: mail.subject,
      body: mail.text,
    });
    return { transport: 'log', delivered: false };
  }
  await smtpSend(m, decryptCredentials(m.secret)?.password ?? '', mail);
  log.info('mail sent', {
    component: 'mail',
    to: mail.to,
    subject: mail.subject,
    via: `${m.host}:${m.port}`,
  });
  return { transport: 'smtp', delivered: true };
}
