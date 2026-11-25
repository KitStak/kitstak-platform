/**
 * The words on kitstak.com/security. Every control named here is in the code today:
 * packages/auth (scrypt hashing, lockout, database-backed rate limits), packages/billing (Stripe
 * webhook signatures), the apps' next.config and proxy files (HSTS, nonce CSP on CRM and Pulse),
 * apps/wms (SSO, audit log, permission groups) and the encryption keys in docs/DEPLOYMENT.md.
 * Do not add a certification, an uptime figure or a feature that is not built. If a control
 * changes, change this file.
 */

export interface SecurityPoint {
  readonly name: string;
  readonly note: string;
}

export interface SecurityGroup {
  readonly id: string;
  readonly title: string;
  readonly lead: string;
  readonly points: readonly SecurityPoint[];
}

export const SECURITY_GROUPS: readonly SecurityGroup[] = [
  {
    id: 'accounts',
    title: 'Accounts and sign-in',
    lead: 'One sign-in for every app, with the same rules on every door.',
    points: [
      {
        name: 'Hashed passwords',
        note: 'Passwords are stored only as salted scrypt hashes. Nobody at KitStak can read them.',
      },
      {
        name: 'Account lockout',
        note: 'Five wrong passwords lock the account for fifteen minutes. The rule is shared, so it holds on every app.',
      },
      {
        name: 'Rate limits',
        note: 'Sign-in and sign-up are rate limited, and the counters live in the database, not in one server.',
      },
      {
        name: 'Safe sessions',
        note: 'Sessions ride in HTTP-only, same-site cookies that scripts on the page cannot read.',
      },
      {
        name: 'Single sign-on',
        note: 'The WMS supports OpenID Connect and SAML for teams that sign in through their own provider.',
      },
      { name: 'No account hints', note: 'A locked account gets the same answer as a wrong password.' },
    ],
  },
  {
    id: 'data',
    title: 'Your data',
    lead: 'Your organization’s data is yours, kept apart from everyone else’s.',
    points: [
      {
        name: 'Scoped to your organization',
        note: 'Every request is checked against your organization before it touches data.',
      },
      {
        name: 'Role-based permissions',
        note: 'Owners, admins, members and viewers, with permission groups by job in the WMS.',
      },
      {
        name: 'Client sign-ins see only their data',
        note: 'A 3PL client user sees its own products, stock and orders, and nothing else.',
      },
      {
        name: 'Encrypted in transit',
        note: 'Every connection uses TLS, and browsers are told never to connect without it.',
      },
      {
        name: 'Secrets encrypted at rest',
        note: 'Integration settings and webhook secrets are encrypted with their own keys.',
      },
      {
        name: 'Not for sale, not for training',
        note: 'We do not sell personal information or use your content for ads or to train models.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments',
    lead: 'Card payments run on Stripe. KitStak never sees your full card number.',
    points: [
      {
        name: 'Cards stay with Stripe',
        note: 'We keep only the card brand, the last four digits and the expiry date, to show in Billing.',
      },
      {
        name: 'Signed webhooks',
        note: 'Every payment event from Stripe is checked against its signature before we act on it.',
      },
      {
        name: 'A billing trail',
        note: 'Plan changes and payments are recorded, so owners can see who did what and when.',
      },
    ],
  },
  {
    id: 'app',
    title: 'Application security',
    lead: 'Defenses built into the pages the apps serve.',
    points: [
      {
        name: 'Content Security Policy',
        note: 'The CRM and Pulse send a fresh nonce with every page, so only our own scripts run. This site sends a strict policy too.',
      },
      {
        name: 'Strict transport',
        note: 'HSTS on the apps and on this site, so browsers only ever connect over HTTPS.',
      },
      {
        name: 'No framing',
        note: 'Our pages refuse to load inside another site’s frame, which blocks clickjacking.',
      },
      {
        name: 'Audit log',
        note: 'Role changes, denied access and other security events are logged for your admins.',
      },
      {
        name: 'Written reviews',
        note: 'Sign-in and session code goes through written security reviews. Each finding is fixed or recorded as an accepted risk.',
      },
    ],
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    lead: 'Built on providers that run some of the largest apps on the web.',
    points: [
      { name: 'Vercel', note: 'Hosts the apps and this site.' },
      { name: 'Supabase', note: 'Runs the managed Postgres database and file storage.' },
      { name: 'Stripe', note: 'Processes card payments.' },
    ],
  },
];

export const DISCLOSURE = {
  title: 'Found a problem? Tell us first.',
  body: 'Email us with "Security" in the subject line. We reply within two business days, keep you posted while we fix it, and credit you if you like. Please do not touch data that is not yours or run anything that slows the service down.',
} as const;
