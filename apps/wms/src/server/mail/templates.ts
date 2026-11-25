/**
 * WMS emails in the shared KitStak layout (@kitstak/mail/layout): the same lockup, card and tones as
 * the account and billing mail, with WAREHOUSE as the header area. Each builder returns content
 * blocks; `sendCompanyMail` renders them to HTML and text and adds the company's branding footer.
 */
import type { EmailContent, EmailStyle } from '@kitstak/mail/layout';

const AREA = 'Warehouse';
const style = (tone: EmailStyle['tone'], eyebrow: string): EmailStyle => ({ tone, eyebrow, area: AREA });

/** "3 days" or "30 minutes" or "36 hours". */
export function validFor(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}

export function passwordResetEmail(input: { readonly link: string; readonly minutes: number }): EmailContent {
  return {
    subject: 'Reset your KitStak password',
    preheader: `This link works for ${validFor(input.minutes)}.`,
    heading: 'Reset your password',
    blocks: [
      {
        kind: 'text',
        text: `Someone asked to reset the password for your KitStak WMS account. Use the button within ${validFor(input.minutes)} to choose a new one.`,
      },
      { kind: 'note', text: 'If you did not ask for this, ignore this email. Your password stays the same.' },
    ],
    button: { label: 'Choose a new password', url: input.link },
    footer: 'You get this email because a password reset was asked for on your KitStak WMS account.',
    style: style('security', 'Password reset'),
  };
}

export function userInviteEmail(input: {
  readonly companyName: string;
  readonly firstName: string;
  readonly invitedBy: string;
  readonly link: string;
  readonly hours: number;
}): EmailContent {
  const company = input.companyName || 'your company';
  const linkLife = validFor(input.hours * 60);
  return {
    subject: `You're invited to ${company} on KitStak`,
    preheader: `${input.invitedBy} created a KitStak WMS account for you.`,
    heading: `Welcome to ${company}`,
    blocks: [
      {
        kind: 'text',
        text: `Hi ${input.firstName || 'there'}, ${input.invitedBy} created a KitStak WMS account for you. Choose your password to sign in for the first time.`,
      },
      {
        kind: 'facts',
        rows: [
          { label: 'Company', value: company },
          { label: 'Invited by', value: input.invitedBy },
          { label: 'Link works for', value: linkLife },
        ],
      },
      {
        kind: 'note',
        text: 'The link works once. After that, ask your administrator for a new invite or use "Forgot password" on the sign-in page.',
      },
    ],
    button: { label: 'Choose your password', url: input.link },
    footer: `You get this email because an administrator at ${company} added you to KitStak WMS.`,
    style: style('welcome', "You're invited"),
  };
}

export function scheduledReportEmail(input: {
  readonly reportTitle: string;
  readonly scheduleName: string;
  readonly rows: number;
  readonly format: string;
  readonly cadence: string;
  readonly downloadUrl: string;
  readonly reportUrl: string;
}): EmailContent {
  const rows = input.rows.toLocaleString('en-US');
  return {
    subject: `[KitStak] ${input.reportTitle} - ${input.scheduleName}`,
    preheader: `${rows} rows, ready to download.`,
    heading: 'Your report is ready',
    blocks: [
      { kind: 'text', text: `The scheduled report "${input.scheduleName}" ran and is ready to download.` },
      {
        kind: 'facts',
        rows: [
          { label: 'Report', value: input.reportTitle },
          { label: 'Rows', value: rows },
          { label: 'Format', value: input.format.toUpperCase() },
          { label: 'Runs', value: input.cadence },
        ],
      },
      {
        kind: 'note',
        text: `Sign-in required. The file is kept for 7 days. Open the report: ${input.reportUrl}`,
      },
    ],
    button: { label: 'Download the report', url: input.downloadUrl },
    footer: 'You get this email because you are on the recipient list of this scheduled report.',
    style: style('notice', 'Scheduled report'),
  };
}

export function mailTestEmail(input: { readonly sentBy: string }): EmailContent {
  return {
    subject: 'KitStak test email',
    preheader: 'Email delivery works.',
    heading: 'Email delivery works',
    blocks: [
      {
        kind: 'text',
        text: `${input.sentBy} sent this test from Company Settings > Email delivery. If you can read it, KitStak can send invites, password resets and scheduled reports.`,
      },
    ],
    button: null,
    footer: 'You get this email because someone sent a test to this address from KitStak WMS.',
    style: style('receipt', 'Test email'),
  };
}
