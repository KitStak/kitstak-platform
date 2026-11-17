'use client';
/** Personal API tokens: create (shown once), scopes, expiry, last used, revoke. Admins can view every token. */
import { useMemo, useState } from 'react';
import { Check, Copy, KeyRound, Plus, TriangleAlert } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Switch,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import {
  API_TOKEN_SCOPES,
  createApiTokenSchema,
  type ApiTokenDto,
  type ApiTokenScope,
  type CreatedApiTokenDto,
} from '@/server/services/admin-contracts';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '../api';
import { formatDate, relativeTime } from '../format';
import { ErrorPanel, SectionHeader, SettingsCard, TABLE_CELL, TABLE_HEAD, TABLE_ROW, TableSkeleton } from '../ui';

const STATUS_TONE = { active: 'success', expired: 'warning', revoked: 'neutral' } as const;

export function ApiSection() {
  return (
    <>
      <SectionHeader title="API" description="Tokens act as you. Treat them like passwords." />
      <ApiTokensPanel allowOrgScope />
    </>
  );
}

export function ApiTokensPanel({ allowOrgScope = false }: { readonly allowOrgScope?: boolean }) {
  const { role } = useOrg();
  const isAdmin = role === 'owner' || role === 'admin';
  const [scope, setScope] = useState<'mine' | 'org'>('mine');
  const tokens = useApiTokens(scope);
  const revoke = useRevokeApiToken();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ApiTokenDto | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const all = useMemo(() => tokens.data ?? [], [tokens.data]);
  const inactiveCount = all.filter((token) => token.status !== 'active').length;
  // Active tokens first (newest first within each group); revoked/expired hidden unless asked for.
  const list = useMemo(
    () =>
      [...all]
        .filter((token) => showInactive || token.status === 'active')
        .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.createdAt.localeCompare(a.createdAt)),
    [all, showInactive],
  );

  return (
    <SettingsCard
      title="Personal API tokens"
      description="You can only see a token right after creating it."
      padded={false}
      testId="api-tokens-card"
      aside={
        <div className="flex flex-wrap items-center gap-3">
          {inactiveCount > 0 ? (
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              label={`Show revoked & expired (${inactiveCount})`}
              data-testid="tokens-show-inactive"
            />
          ) : null}
          {allowOrgScope && isAdmin ? (
            <ToggleGroup
              label="Token owner"
              size="sm"
              value={scope}
              onValueChange={setScope}
              options={[
                { value: 'mine' as const, label: 'My tokens' },
                { value: 'org' as const, label: 'Everyone' },
              ]}
            />
          ) : null}
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)} data-testid="token-create-open">
            New token
          </Button>
        </div>
      }
    >
      {tokens.isPending ? (
        <TableSkeleton rows={3} columns={4} />
      ) : tokens.isError ? (
        <ErrorPanel title="Couldn't load tokens" onRetry={() => void tokens.refetch()} />
      ) : list.length === 0 && all.length > 0 ? (
        <EmptyState
          size="sm"
          illustration="inbox"
          title="No active tokens"
          description={`${inactiveCount} revoked or expired ${inactiveCount === 1 ? 'token is' : 'tokens are'} hidden.`}
          actions={
            <Button size="sm" variant="secondary" onClick={() => setShowInactive(true)}>
              Show them
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          size="sm"
          visual={
            <span className="flex size-12 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
              <KeyRound aria-hidden className="size-6" />
            </span>
          }
          title="No API tokens yet"
          description="Create a token to connect a script, a BI tool or your own integration."
          actions={
            <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
              New token
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-base" data-testid="tokens-table">
            <thead className="border-b border-border-subtle bg-sunken/60">
              <tr>
                <th className={TABLE_HEAD}>Token</th>
                <th className={TABLE_HEAD}>Scopes</th>
                <th className={cn(TABLE_HEAD, 'hidden md:table-cell')}>Last used</th>
                <th className={TABLE_HEAD}>Expires</th>
                <th className={TABLE_HEAD}>Status</th>
                <th className={cn(TABLE_HEAD, 'text-right')}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((token) => (
                <tr
                  key={token.id}
                  className={cn(TABLE_ROW, token.status !== 'active' && 'bg-sunken/40 text-fg-muted')}
                  data-testid="token-row"
                  data-status={token.status}
                >
                  <td className={TABLE_CELL}>
                    <span className={cn('block font-medium', token.status === 'active' ? 'text-fg' : 'text-fg-muted line-through decoration-1')}>
                      {token.name}
                    </span>
                    <span className="block font-mono text-xs text-fg-muted">
                      {token.prefix}…{scope === 'org' && token.userName ? ` · ${token.userName}` : ''}
                    </span>
                  </td>
                  <td className={TABLE_CELL}>
                    <span className={cn('flex max-w-[240px] flex-wrap gap-1', token.status !== 'active' && 'opacity-60')}>
                      {token.scopes.map((entry) => (
                        <Badge key={entry} size="sm" tone="outline">
                          {entry}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className={cn(TABLE_CELL, 'hidden text-sm text-fg-secondary md:table-cell')}>{relativeTime(token.lastUsedAt)}</td>
                  <td className={cn(TABLE_CELL, 'text-sm whitespace-nowrap text-fg-secondary')}>
                    {token.expiresAt ? formatDate(token.expiresAt) : 'Never'}
                  </td>
                  <td className={TABLE_CELL}>
                    <Badge tone={STATUS_TONE[token.status]}>{token.status[0]?.toUpperCase() + token.status.slice(1)}</Badge>
                  </td>
                  <td className={cn(TABLE_CELL, 'text-right')}>
                    {token.status === 'active' ? (
                      <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(token)} aria-label={`Revoke ${token.name}`}>
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateTokenDialog open={creating} onOpenChange={setCreating} isAdmin={isAdmin} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        destructive
        title={`Revoke “${confirm?.name ?? ''}”?`}
        description="Anything using this token stops working immediately. This can’t be undone."
        confirmLabel="Revoke token"
        onConfirm={() => {
          if (confirm) revoke.mutate(confirm.id, { onSuccess: () => toast.success('Token revoked') });
          setConfirm(null);
        }}
      />
    </SettingsCard>
  );
}

function CreateTokenDialog({
  open,
  onOpenChange,
  isAdmin,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly isAdmin: boolean;
}) {
  const create = useCreateApiToken();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiTokenScope[]>(['boards:read']);
  const [expiry, setExpiry] = useState('90');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiTokenDto | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setName('');
    setScopes(['boards:read']);
    setExpiry('90');
    setError(null);
    setCreated(null);
    setCopied(false);
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = () => {
    const parsed = createApiTokenSchema.safeParse({
      name,
      scopes,
      expiresInDays: expiry === 'never' ? null : Number(expiry),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    setError(null);
    create.mutate(parsed.data, {
      onSuccess: (token) => setCreated(token),
      onError: (failure) => setError(errorMessage(failure)),
    });
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      toast.success('Token copied');
    } catch {
      toast.error('Could not copy', 'Select the token and copy it manually.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md" data-testid="token-dialog">
        {created ? (
          <>
            <DialogHeader title="Copy your new token" description="For your security it won’t be shown again." />
            <DialogBody className="flex flex-col gap-3 pb-4">
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-sunken p-2">
                <code className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-fg select-all" data-testid="token-value">
                  {created.token}
                </code>
                <Button size="sm" variant={copied ? 'secondary' : 'primary'} leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />} onClick={() => void copy()}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-text">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                Store it in a secret manager. Send it as <code className="font-mono">Authorization: Bearer …</code>.
              </p>
            </DialogBody>
            <DialogFooter>
              <Button onClick={() => close(false)} data-testid="token-done">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader title="New API token" />
            <DialogBody className="flex flex-col gap-4 pb-4">
              <Field label="Name" required error={error}>
                {({ inputId, describedBy, invalid }) => (
                  <Input
                    id={inputId}
                    autoFocus
                    aria-describedby={describedBy}
                    invalid={invalid}
                    placeholder="e.g. Nightly BI sync"
                    value={name}
                    maxLength={60}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submit();
                    }}
                    data-testid="token-name"
                  />
                )}
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold text-fg-secondary">Scopes</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {API_TOKEN_SCOPES.map((entry) => {
                    const locked = entry.value === 'audit:read' && !isAdmin;
                    return (
                      <Checkbox
                        key={entry.value}
                        disabled={locked}
                        checked={scopes.includes(entry.value)}
                        onCheckedChange={(value) =>
                          setScopes(value === true ? [...scopes, entry.value] : scopes.filter((scope) => scope !== entry.value))
                        }
                        label={entry.label}
                        description={locked ? 'Admins only' : entry.value}
                      />
                    );
                  })}
                </div>
              </fieldset>
              <Field label="Expires">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={expiry}
                    onValueChange={setExpiry}
                    options={[
                      { value: '30', label: 'In 30 days' },
                      { value: '90', label: 'In 90 days' },
                      { value: '365', label: 'In 1 year' },
                      { value: 'never', label: 'Never (not recommended)' },
                    ]}
                  />
                )}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={submit} loading={create.isPending} disabled={scopes.length === 0} data-testid="token-create">
                Create token
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
