import type { Metadata } from 'next';
import { listApiTokens, type ApiTokenSummary } from '@kitstak/db/api-tokens';
import { Badge, Card, Eyebrow, Notice } from '@/components/ui';
import { CreateTokenForm, RevokeTokenButton } from '@/features/api-tokens/api-token-forms';
import { TOKEN_APPS, describeScopes, isTokenManager, tokenDate, type TokenApp } from '@/features/api-tokens/token-model';
import { db } from '@/server/db';
import { getOrgModuleStates } from '@/server/entitlements';
import { resolveActiveOrg } from '@/server/orgs';
import { requirePageSession } from '@/server/session';

export const metadata: Metadata = { title: 'API tokens' };

const STATE_BADGE: Readonly<Record<ApiTokenSummary['state'], { readonly label: string; readonly tone: 'success' | 'neutral' | 'warning' }>> = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Revoked', tone: 'warning' },
};

/**
 * Settings, API tokens (docs/integration/AGENT_WRITE_API.md): personal tokens that let a program,
 * such as Claude, read or change KitStak data as you. One token works in every app it names.
 * Everyone sees their own tokens; org owners and admins see and can revoke everyone's.
 */
export default async function ApiTokensPage() {
  const session = await requirePageSession('/settings/api-tokens');
  const org = await resolveActiveOrg(session);

  if (!org) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6" data-testid="api-tokens-page">
        <Header />
        <Notice tone="info">Join an organization to make API tokens.</Notice>
      </div>
    );
  }

  const manager = isTokenManager(org.role);
  const [{ modules }, tokens] = await Promise.all([
    getOrgModuleStates(org.id),
    listApiTokens(db, { orgId: org.id, userId: session.user.id, includeOthers: manager }),
  ]);
  const apps = TOKEN_APPS.filter((app) => modules.some((m) => m.module === app && m.entitled)) as TokenApp[];
  const live = tokens.filter((t) => t.state === 'active');
  const past = tokens.filter((t) => t.state !== 'active');

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6" data-testid="api-tokens-page">
      <Header />

      <Card className="p-5 sm:p-6">
        <Eyebrow>Make a token</Eyebrow>
        <div className="mt-3">
          {apps.length > 0 ? (
            <CreateTokenForm apps={apps} />
          ) : (
            <p className="text-sm text-fg-secondary">Your plan has no apps that take API tokens yet: CRM, Projects or Pulse.</p>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <Eyebrow>{manager ? `Tokens in ${org.name}` : 'Your tokens'}</Eyebrow>
        {live.length === 0 ? (
          <p className="mt-3 text-sm text-fg-secondary" data-testid="api-tokens-empty">
            No active tokens.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-border" data-testid="api-tokens-list">
            {live.map((token) => (
              <TokenRow key={token.id} token={token} showOwner={manager && token.ownerId !== session.user.id} canRevoke={manager || token.ownerId === session.user.id} />
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-fg-secondary">Expired and revoked ({past.length})</summary>
            <ul className="mt-2 flex flex-col divide-y divide-border">
              {past.map((token) => (
                <TokenRow key={token.id} token={token} showOwner={manager && token.ownerId !== session.user.id} canRevoke={false} />
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">API tokens</h1>
      <p className="mt-1 text-md text-fg-secondary">
        A token lets a program, such as Claude, read or change KitStak data as you. It never does more than you can, and it stops working when it expires or you revoke it.
      </p>
    </header>
  );
}

function TokenRow({ token, showOwner, canRevoke }: { readonly token: ApiTokenSummary; readonly showOwner: boolean; readonly canRevoke: boolean }) {
  const badge = STATE_BADGE[token.state];
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="api-token-row">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-md font-medium text-fg">
          <span className="[overflow-wrap:anywhere]">{token.name}</span>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </p>
        <p className="mt-0.5 font-mono text-sm text-fg-secondary">{token.prefix}...</p>
        <p className="mt-1 text-sm text-fg-secondary">{describeScopes(token.scopes)}</p>
        <p className="mt-1 text-sm text-fg-secondary">
          {showOwner ? `${token.ownerName} · ` : ''}Made {tokenDate(token.createdAt)} · {token.state === 'active' ? `Expires ${tokenDate(token.expiresAt)}` : token.state === 'revoked' ? `Revoked ${tokenDate(token.revokedAt)}` : `Expired ${tokenDate(token.expiresAt)}`} · Last used {tokenDate(token.lastUsedAt)}
        </p>
      </div>
      {canRevoke && token.state === 'active' ? <RevokeTokenButton tokenId={token.id} name={token.name} /> : null}
    </li>
  );
}
