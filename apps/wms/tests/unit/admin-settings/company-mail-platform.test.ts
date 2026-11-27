/**
 * Company mail picks its way out: the company SMTP server when it is set up, else KitStak's email
 * service (Resend through @kitstak/mail) when the platform has it, else the server log.
 * Resend and the SMTP socket are mocked: nothing leaves the test.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@/server/api/db';

const mail = vi.hoisted(() => ({
  resendReady: vi.fn<() => boolean>(),
  sendWithResend: vi.fn(),
}));
vi.mock('@kitstak/mail', () => mail);

vi.mock('@/server/repositories/apps-branding', () => ({
  getBranding: vi.fn(async () => ({ emailFooter: 'Acme Warehouse, 1 Dock Rd' })),
}));

const netConnect = vi.hoisted(() => vi.fn());
vi.mock('node:net', () => ({ connect: netConnect }));

import {
  buildMessage,
  encodeHeader,
  getMailSettings,
  renderOutbound,
  sendCompanyMail,
} from '@/server/repositories/company-mail';
import {
  mailTestEmail,
  passwordResetEmail,
  scheduledReportEmail,
  userInviteEmail,
  validFor,
} from '@/server/mail/templates';
import { welcomeToastText } from '@/lib/grid-defs/admin/company-mail';

/** A database whose only row is the company settings row with this mail block. */
function dbWith(stored: Record<string, unknown> | null): AppDb {
  const rows = [{ defaults: stored ? { mail: stored } : {}, version: 3 }];
  const chain = { from: () => chain, where: () => chain, limit: async () => rows };
  return { select: () => chain } as unknown as AppDb;
}

const MESSAGE = { to: 'jo@acme.test', subject: 'Reset your KitStaks password', text: 'Open this link.' };

beforeEach(() => {
  mail.resendReady.mockReturnValue(false);
  mail.sendWithResend.mockResolvedValue({ ok: true, messageId: 'msg_1' });
});

describe('sendCompanyMail without company SMTP', () => {
  it('sends through KitStak email when the platform has Resend set up', async () => {
    mail.resendReady.mockReturnValue(true);
    const result = await sendCompanyMail(dbWith({ transport: 'log', fromAddress: 'ops@acme.test' }), MESSAGE);

    expect(result).toEqual({ transport: 'resend', delivered: true });
    expect(mail.sendWithResend).toHaveBeenCalledTimes(1);
    expect(mail.sendWithResend).toHaveBeenCalledWith({
      to: 'jo@acme.test',
      subject: 'Reset your KitStaks password',
      text: 'Open this link.\n\n--\nAcme Warehouse, 1 Dock Rd\n',
      replyTo: 'ops@acme.test',
    });
  });

  it('leaves reply-to to the platform when the company has no From address', async () => {
    mail.resendReady.mockReturnValue(true);
    await sendCompanyMail(dbWith(null), MESSAGE);

    expect(mail.sendWithResend.mock.calls[0]![0]).not.toHaveProperty('replyTo');
  });

  it('treats half-filled SMTP settings as no SMTP', async () => {
    mail.resendReady.mockReturnValue(true);
    const result = await sendCompanyMail(
      dbWith({ transport: 'smtp', host: '', fromAddress: 'ops@acme.test' }),
      MESSAGE,
    );

    expect(result.transport).toBe('resend');
    expect(netConnect).not.toHaveBeenCalled();
  });

  it('throws when Resend refuses, so no caller claims a delivery', async () => {
    mail.resendReady.mockReturnValue(true);
    mail.sendWithResend.mockResolvedValue({
      ok: false,
      kind: 'config',
      error: 'Resend answered 403. The domain is not verified',
    });

    await expect(sendCompanyMail(dbWith(null), MESSAGE)).rejects.toThrow(
      /KitStak email could not send this message/,
    );
  });

  it('writes to the server log when the platform has no Resend either', async () => {
    const result = await sendCompanyMail(dbWith(null), MESSAGE);

    expect(result).toEqual({ transport: 'log', delivered: false });
    expect(mail.sendWithResend).not.toHaveBeenCalled();
  });
});

describe('sendCompanyMail with company SMTP', () => {
  it('uses the company server, never Resend', async () => {
    mail.resendReady.mockReturnValue(true);
    netConnect.mockImplementation(() => {
      const socket = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() });
      queueMicrotask(() => socket.emit('error', new Error('connection refused')));
      return socket;
    });
    const db = dbWith({
      transport: 'smtp',
      host: 'smtp.acme.test',
      port: 587,
      security: 'starttls',
      fromAddress: 'ops@acme.test',
    });

    await expect(sendCompanyMail(db, MESSAGE)).rejects.toThrow(/Couldn't reach smtp.acme.test:587/);
    expect(netConnect).toHaveBeenCalledTimes(1);
    expect(mail.sendWithResend).not.toHaveBeenCalled();
  });
});

describe('what the screens say', () => {
  it('the settings view reports whether KitStak email is available', async () => {
    mail.resendReady.mockReturnValue(true);
    expect((await getMailSettings(dbWith(null))).platformMail).toBe(true);
    mail.resendReady.mockReturnValue(false);
    expect((await getMailSettings(dbWith(null))).platformMail).toBe(false);
  });

  it('an invite sent by KitStak email is a success toast', () => {
    expect(welcomeToastText({ name: 'Jo', requested: true, transport: 'resend' }).tone).toBe('success');
    expect(welcomeToastText({ name: 'Jo', requested: true, transport: 'log' }).tone).toBe('attention');
  });
});

describe('designed WMS emails (KitStak layout)', () => {
  const content = passwordResetEmail({ link: 'https://wms.test/reset-password?token=abc', minutes: 30 });

  it('every WMS template is in the Warehouse area with its tone, and carries its link', () => {
    const invite = userInviteEmail({
      companyName: 'Acme',
      firstName: 'Jo',
      invitedBy: 'Maya Chen',
      link: 'https://wms.test/r?t=1',
      hours: 72,
    });
    const report = scheduledReportEmail({
      reportTitle: 'Inventory on hand',
      scheduleName: 'Monday count',
      rows: 1284,
      format: 'xlsx',
      cadence: 'Weekly',
      downloadUrl: 'https://wms.test/api/files/f1',
      reportUrl: 'https://wms.test/reports/inventory',
    });
    const test = mailTestEmail({ sentBy: 'Maya Chen' });
    expect([content, invite, report, test].map((c) => [c.style?.area, c.style?.tone])).toEqual([
      ['Warehouse', 'security'],
      ['Warehouse', 'welcome'],
      ['Warehouse', 'notice'],
      ['Warehouse', 'receipt'],
    ]);
    expect(invite.blocks).toContainEqual(expect.objectContaining({ kind: 'facts' }));
    expect(validFor(72 * 60)).toBe('3 days');
    expect(validFor(30)).toBe('30 minutes');
    expect(renderOutbound({ to: 'a@b.test', subject: '', text: '', content: report }).text).toContain(
      'https://wms.test/api/files/f1',
    );
  });

  it('renders HTML and text from the content and adds the company footer to both', () => {
    const out = renderOutbound(
      { to: 'jo@acme.test', subject: 'ignored', text: 'ignored', content },
      'Acme Warehouse\n1 Dock Rd',
    );
    expect(out.subject).toBe('Reset your KitStak password');
    expect(out.html).toContain('kitstak-lockup-navy.png');
    expect(out.html).toContain('Acme Warehouse<br>1 Dock Rd');
    expect(out.text).toContain('https://wms.test/reset-password?token=abc');
    expect(out.text).toContain('Acme Warehouse\n1 Dock Rd');
  });

  it('keeps plain text mail plain', () => {
    const out = renderOutbound({ to: 'jo@acme.test', subject: 'Hi', text: 'Body' }, 'Footer');
    expect(out).toEqual({ to: 'jo@acme.test', subject: 'Hi', text: 'Body\n\n--\nFooter\n' });
  });

  it('builds a multipart SMTP message with a base64 HTML part inside SMTP line limits', () => {
    const out = renderOutbound({ to: 'jo@acme.test', subject: '', text: '', content });
    const msg = buildMessage(
      { address: 'ops@acme.test', name: 'Acme' },
      out,
      new Date('2026-12-07T15:00:00Z'),
    );
    const boundary = /boundary="([^"]+)"/.exec(msg)?.[1];
    expect(boundary).toBeTruthy();
    expect(msg).toContain('Content-Type: multipart/alternative');
    expect(msg).toContain('Content-Type: text/plain; charset=utf-8');
    expect(msg).toContain('Content-Type: text/html; charset=utf-8');
    expect(msg.endsWith(`--${boundary}--`)).toBe(true);
    for (const line of msg.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
    const htmlPart = msg.split(`--${boundary}`)[2]!.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(htmlPart, 'base64').toString('utf8')).toBe(out.html);
  });

  it('sends the HTML through KitStak email', async () => {
    mail.resendReady.mockReturnValue(true);
    await sendCompanyMail(dbWith(null), { to: 'jo@acme.test', subject: '', text: '', content });
    const sent = mail.sendWithResend.mock.calls[0]![0] as { html?: string; text: string; subject: string };
    expect(sent.subject).toBe('Reset your KitStak password');
    expect(sent.html).toContain('Choose a new password');
    expect(sent.text).toContain('https://wms.test/reset-password?token=abc');
  });
});

describe('SMTP headers with non-ASCII text', () => {
  it('encodes a subject and a From name with accents (RFC 2047) and leaves ASCII alone', () => {
    expect(encodeHeader('Reset your KitStak password')).toBe('Reset your KitStak password');
    const encoded = encodeHeader("You're invited to Café Logística on KitStak");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    for (const word of encoded.split('\r\n ')) expect(word.length).toBeLessThanOrEqual(75);
    const decoded = encoded
      .split('\r\n ')
      .map((w) => Buffer.from(w.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8'))
      .join('');
    expect(decoded).toBe("You're invited to Café Logística on KitStak");
    expect(encodeHeader('Ünïcode\r\nBcc: evil@x.io')).not.toMatch(/\r\nBcc:/);
    const msg = buildMessage(
      { address: 'ops@cafe.test', name: 'Café Ops' },
      { to: 'jo@x.test', subject: 'Héllo', text: 'Hi' },
    );
    expect(msg).toMatch(/^From: =\?UTF-8\?B\?[^\r\n]+\?= <ops@cafe\.test>/);
    expect(msg).toContain(`Subject: ${encodeHeader('Héllo')}`);
  });
});
