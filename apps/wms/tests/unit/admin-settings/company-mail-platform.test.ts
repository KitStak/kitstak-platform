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

import { getMailSettings, sendCompanyMail } from '@/server/repositories/company-mail';
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
