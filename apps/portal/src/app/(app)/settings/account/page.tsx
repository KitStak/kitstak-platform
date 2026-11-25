import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Card, Eyebrow, LinkButton, Notice } from '@/components/ui';
import { safeReturnUrl } from '@/lib/routes';
import { getAccountFacts } from '@/server/account';
import { trustedOrigins } from '@/server/env';
import { requirePageSession } from '@/server/session';
import { NameForm, SetPasswordForm } from './account-forms';

export const metadata: Metadata = { title: 'My account' };

const PROVIDER_NAMES: Readonly<Record<string, string>> = { google: 'Google', microsoft: 'Microsoft' };

/**
 * "My account" (review round 4): the person's name, their email, and how they sign in. It is the
 * one place to set a password for an account that has none: a person who signed up with "Email me
 * a code instead", or one whose password was removed because their email was never verified
 * before their first code sign in. The same account works in every KitStak app.
 */
export default async function AccountPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePageSession('/settings/account');
  const facts = await getAccountFacts(session.user.id);
  if (!facts) redirect('/login');
  const params = await searchParams;
  const passwordRemoved = params.notice === 'password-removed' && !facts.hasPassword;
  // The page the person was on their way to when they signed in. Trusted KitStak addresses only.
  const onward = safeReturnUrl(typeof params.next === 'string' ? params.next : null, trustedOrigins(), '');
  const providers = facts.providers.map((id) => PROVIDER_NAMES[id] ?? id);

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6" data-testid="account-page">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">My account</h1>
        <p className="mt-1 text-md text-fg-secondary">Your name, your email and how you sign in. One account works in every KitStak app.</p>
      </header>

      {passwordRemoved ? (
        <Notice
          tone="warning"
          testId="account-password-removed"
          action={
            onward !== '' ? (
              <LinkButton href={onward} variant="secondary" size="lg" data-testid="account-continue">
                Not now
              </LinkButton>
            ) : undefined
          }
        >
          You are signed in. Your old password no longer works: this email was never verified before today, so we removed
          that password to keep your account safe. Set a new one below, or keep signing in with a code.
        </Notice>
      ) : null}

      <Card className="p-5 sm:p-6">
        <Eyebrow>Name</Eyebrow>
        <div className="mt-3">
          <NameForm name={facts.name} />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <Eyebrow>Email</Eyebrow>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-md font-medium text-fg" data-testid="account-email">
          <span className="min-w-0 [overflow-wrap:anywhere]">{facts.email}</span>
          {facts.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
        </p>
        <p className="mt-1 text-sm text-fg-secondary">
          {facts.emailVerified
            ? 'You sign in with this email. Receipts and invites use it too.'
            : 'Verify your email with a 6 digit code. Then you can invite people and pay.'}
        </p>
        {facts.emailVerified ? null : (
          <div className="mt-4">
            <LinkButton href="/verify-email?next=/settings/account" variant="secondary" size="lg" data-testid="account-verify">
              Verify my email
            </LinkButton>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6" id="password">
        <Eyebrow>Password</Eyebrow>
        {facts.hasPassword ? (
          <div className="mt-3" data-testid="account-has-password">
            <p className="text-md font-medium text-fg">You have a password.</p>
            <p className="mt-1 text-sm text-fg-secondary">
              To change it, we email you a 6 digit code first. Every other device is signed out when you save the new one.
            </p>
            <div className="mt-4">
              <LinkButton href="/forgot-password" variant="secondary" size="lg" data-testid="account-change-password">
                Change my password
              </LinkButton>
            </div>
          </div>
        ) : (
          <div className="mt-3" data-testid="account-no-password">
            <p className="text-md font-medium text-fg">You have no password.</p>
            <p className="mt-1 text-sm text-fg-secondary">
              You sign in with a 6 digit code we email you{providers.length > 0 ? `, or with ${providers.join(' or ')}` : ''}. That keeps
              working. A password is one more way in, if you want one.
            </p>
            <div className="mt-4">
              <SetPasswordForm email={facts.email} />
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <Eyebrow>Ways to sign in</Eyebrow>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-fg-secondary" data-testid="account-sign-in-ways">
          <li>
            <span className="font-medium text-fg">A code by email.</span> Always there. Pick &quot;Email me a code instead&quot; on the sign in page.
          </li>
          <li>
            <span className="font-medium text-fg">A password.</span> {facts.hasPassword ? 'Set.' : 'Not set.'}
          </li>
          {providers.map((provider) => (
            <li key={provider}>
              <span className="font-medium text-fg">{provider}.</span> Connected.
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
