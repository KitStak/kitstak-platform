/** Company Settings › Email delivery: form schema, view type and the invite email template. PURE. */
import { z } from 'zod';
import { versionField } from './common';

export const MAIL_TRANSPORTS = ['log', 'smtp'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];
/**
 * How one email actually went out: the company SMTP server, KitStak's own email service (used
 * when the company has no SMTP of its own and the platform has Resend set up), or the server log.
 */
export type MailDelivery = 'smtp' | 'resend' | 'log';
export const MAIL_SECURITIES = ['starttls', 'tls', 'none'] as const;
export type MailSecurity = (typeof MAIL_SECURITIES)[number];

export const MAIL_SECURITY_OPTIONS: readonly { value: MailSecurity; label: string; port: number }[] = [
  { value: 'starttls', label: 'STARTTLS (port 587)', port: 587 },
  { value: 'tls', label: 'SSL/TLS (port 465)', port: 465 },
  { value: 'none', label: 'None (local relay, port 25)', port: 25 },
];

/** Days an invite (welcome) link stays valid. A reset link stays valid for minutes. */
export const INVITE_TTL_HOURS = 72;

export const mailSettingsSchema = z.object({
  transport: z.enum(MAIL_TRANSPORTS),
  host: z
    .string()
    .trim()
    .max(253)
    .regex(/^[A-Za-z0-9.-]*$/, 'Use a host name such as smtp.example.com')
    .default(''),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(MAIL_SECURITIES),
  username: z.string().trim().max(254).default(''),
  /** Blank keeps the stored password. */
  password: z.string().max(500).optional(),
  clearPassword: z.boolean().optional(),
  fromAddress: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email address').max(254)])
    .default(''),
  fromName: z.string().trim().max(120).default(''),
  version: versionField,
});
export type MailSettingsInput = z.output<typeof mailSettingsSchema>;

export const mailTestSchema = z.object({
  to: z.string().trim().email('Enter a valid email address').max(254),
});

export interface MailSettingsView {
  readonly transport: MailTransport;
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  readonly username: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly passwordSet: boolean;
  /** Last 2 characters of the stored password, for "••••xy". */
  readonly passwordHint: string | null;
  /** True when real email is sent (SMTP with server and From address). */
  readonly ready: boolean;
  /**
   * True when KitStak's email service is set up for this install (RESEND_API_KEY and EMAIL_FROM).
   * Without company SMTP, invites, password resets and report links then go out through it.
   */
  readonly platformMail: boolean;
  readonly version: number;
}

/** The welcome / invite email: its own wording and a multi-day link, not the reset email. */
export function inviteEmail(input: {
  readonly companyName: string;
  readonly firstName: string;
  readonly invitedBy: string;
  readonly link: string;
  readonly hours?: number;
}): { subject: string; text: string } {
  const hours = input.hours ?? INVITE_TTL_HOURS;
  const days = Math.round(hours / 24);
  const validFor = hours % 24 === 0 ? `${days} day${days === 1 ? '' : 's'}` : `${hours} hours`;
  return {
    subject: `You're invited to ${input.companyName} on KitStaks`,
    text: [
      `Hi ${input.firstName || 'there'},`,
      '',
      `${input.invitedBy} created a KitStaks account for you at ${input.companyName}.`,
      'Choose your password with this link to sign in for the first time:',
      input.link,
      '',
      `The link works once and stays valid for ${validFor}. After that, ask your administrator to send a new invite or use "Forgot password" on the sign-in page.`,
    ].join('\n'),
  };
}

/** What the Add user toast says, from what the server actually did. */
export function welcomeToastText(input: {
  readonly name: string;
  readonly requested: boolean;
  readonly transport: MailDelivery | null;
  readonly error?: string | null;
}): { tone: 'success' | 'attention'; text: string } {
  if (!input.requested)
    return { tone: 'success', text: `${input.name} can sign in now with the password you set.` };
  if (input.error)
    return {
      tone: 'attention',
      text: `${input.name} was created, but the invite email failed: ${input.error}. They can sign in with the password you set.`,
    };
  if (input.transport === 'smtp' || input.transport === 'resend')
    return {
      tone: 'success',
      text: `Invite emailed to ${input.name}. The link lets them choose their own password within ${INVITE_TTL_HOURS / 24} days; the password you set works until then.`,
    };
  return {
    tone: 'attention',
    text: `${input.name} was created. Email delivery isn't set up (Company Settings › Email delivery), so the invite was written to the server log only. They can sign in with the password you set.`,
  };
}
