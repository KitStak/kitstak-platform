'use client';
/** Admin → Security: active sessions, sign-in policy, allowed email domains and IP allow-list. */
import { useMemo, useState } from 'react';
import { Bot, LogOut, Monitor, Plus, ShieldCheck, Smartphone, Tablet, X } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  SearchInput,
  Switch,
  Textarea,
  cn,
  toast,
} from '@/components/ui';
import { emailDomainSchema, PASSWORD_POLICY, type AdminSessionDto } from '@/server/services/admin-contracts';
import { invalidIpRules, ipAllowed } from '@/server/services/admin-policy';
import { useOrgAdmin, useOrgSessions, useRevokeOrgSession, useUpdateOrgPolicy } from '../api';
import { formatDateTime, formatIp, pluralize, relativeTime } from '../format';
import {
  DemoBadge,
  ErrorPanel,
  SectionHeader,
  SettingRow,
  SettingsCard,
  SettingsSkeleton,
  SortableHeader,
  TABLE_CELL,
  TABLE_HEAD,
  TABLE_ROW,
  TableSkeleton,
  useTableSort,
} from '../ui';

type SessionSortKey = 'person' | 'refreshed';
const SESSION_SORT: Readonly<Record<SessionSortKey, (row: AdminSessionDto) => string | number | null>> = {
  person: (row) => row.userName,
  refreshed: (row) => Date.parse(row.lastActiveAt),
};

const NEWLINE = String.fromCharCode(10);
const DEVICE_ICON ={ desktop: Monitor, mobile: Smartphone, tablet: Tablet, bot: Bot, unknown: Monitor } as const;

export function SecuritySection() {
  return (
    <>
      <SectionHeader
        title="Security"
        description="Control how people sign in, where they can connect from, and which sessions are active."
      />
      <SessionsCard />
      <SignInPolicyCard />
      <EmailDomainsCard />
      <IpAllowListCard />
    </>
  );
}

function SessionsCard() {
  const sessions = useOrgSessions();
  const revoke = useRevokeOrgSession();
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<AdminSessionDto | null>(null);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (sessions.data ?? []).filter(
      (entry) =>
        !term ||
        entry.userName.toLowerCase().includes(term) ||
        entry.userEmail.toLowerCase().includes(term) ||
        (entry.ipAddress ?? '').includes(term),
    );
  }, [sessions.data, q]);
  const { sorted, sort, toggle } = useTableSort(filtered, SESSION_SORT, { key: 'refreshed', direction: 'desc' });
  // Your own session always stays on top so it is easy to find.
  const list = useMemo(() => [...sorted.filter((entry) => entry.current), ...sorted.filter((entry) => !entry.current)], [sorted]);

  return (
    <SettingsCard
      title="Active sessions"
      description="Members of this organization who are signed in. Sessions are account-wide: signing one out ends it in every organization that person belongs to."
      padded={false}
      testId="sessions-card"
      aside={sessions.data ? <Badge>{pluralize(sessions.data.length, 'session')}</Badge> : null}
    >
      <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
        <SearchInput value={q} onValueChange={setQ} placeholder="Filter by person or IP" containerClassName="sm:w-72" aria-label="Filter sessions" />
      </div>
      {sessions.isPending ? (
        <TableSkeleton rows={4} columns={3} />
      ) : sessions.isError ? (
        <ErrorPanel title="Couldn't load sessions" onRetry={() => void sessions.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState size="sm" illustration="search" title="No sessions match" description="Try another name or IP address." />
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[600px] text-base">
            <thead className="sticky top-0 z-[1] border-b border-border-subtle bg-sunken">
              <tr>
                <SortableHeader label="Person" sortKey="person" sort={sort} onSort={toggle} />
                <th className={TABLE_HEAD}>Device</th>
                <th className={cn(TABLE_HEAD, 'hidden md:table-cell')}>IP address</th>
                <SortableHeader label="Last refreshed" sortKey="refreshed" sort={sort} onSort={toggle} />
                <th className={cn(TABLE_HEAD, 'text-right')}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => {
                const Icon = DEVICE_ICON[entry.device.kind];
                return (
                  <tr key={entry.id} className={TABLE_ROW} data-testid="session-row">
                    <td className={TABLE_CELL}>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={entry.userName} src={entry.image} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{entry.userName}</span>
                          <span className="block truncate text-xs text-fg-muted">{entry.userEmail}</span>
                        </span>
                      </span>
                    </td>
                    <td className={TABLE_CELL}>
                      <span className="flex items-center gap-2 text-sm text-fg-secondary">
                        <Icon aria-hidden className="size-4 shrink-0 text-icon" />
                        <span className="max-w-[180px] truncate">
                          {entry.device.browser} · {entry.device.os}
                        </span>
                        {entry.current ? <Badge tone="success" size="sm">This device</Badge> : null}
                      </span>
                    </td>
                    <td className={cn(TABLE_CELL, 'hidden font-mono text-xs text-fg-secondary md:table-cell')}>
                      {formatIp(entry.ipAddress)}
                    </td>
                    <td className={cn(TABLE_CELL, 'text-sm whitespace-nowrap text-fg-secondary')} title={`Signed in ${formatDateTime(entry.createdAt)} · session refreshes about once a day while in use`}>
                      {relativeTime(entry.lastActiveAt)}
                    </td>
                    <td className={cn(TABLE_CELL, 'w-12 text-right')}>
                      <IconButton
                        size="sm"
                        icon={<LogOut aria-hidden />}
                        disabled={entry.current}
                        onClick={() => setConfirm(entry)}
                        label={entry.current ? 'This is your current session' : `Sign out ${entry.userName} (${entry.device.browser})`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        destructive
        title={`Sign out ${confirm?.userName ?? ''}?`}
        description={`Their ${confirm?.device.browser ?? ''} session on ${confirm?.device.os ?? ''} ends now — in KitStak everywhere, including any other organizations they belong to. They can sign in again with their password.`}
        confirmLabel="Sign out session"
        onConfirm={() => {
          if (confirm) revoke.mutate(confirm.id, { onSuccess: () => toast.success('Session signed out') });
          setConfirm(null);
        }}
      />
    </SettingsCard>
  );
}

function SignInPolicyCard() {
  return (
    <SettingsCard title="Sign-in & passwords" description="Applies to every member who signs in with email and password.">
      <SettingRow label="Password requirements" description="Checked at sign-up, password change and reset.">
        <ul className="flex flex-col gap-1 text-base text-fg">
          <li>
            {PASSWORD_POLICY.minLength}–{PASSWORD_POLICY.maxLength} characters
          </li>
          <li className="text-fg-secondary">Resetting a password signs out every other session</li>
        </ul>
      </SettingRow>
      <SettingRow label="Session length" description="Sessions refresh while people are active.">
        <p className="text-base text-fg">
          {PASSWORD_POLICY.sessionDays} days, refreshed every {PASSWORD_POLICY.refreshHours} hours of activity
        </p>
      </SettingRow>
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            Two-factor authentication <DemoBadge>Not available yet</DemoBadge>
          </span>
        }
        description="Require an authenticator app for everyone. Placeholder: this build does not enforce 2FA."
      >
        <Switch disabled checked={false} aria-label="Require two-factor authentication (not available)" />
      </SettingRow>
    </SettingsCard>
  );
}

function EmailDomainsCard() {
  const org = useOrgAdmin();
  const update = useUpdateOrgPolicy();
  const [domains, setDomains] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saved = org.data?.settings.allowedEmailDomains;
  const [seed, setSeed] = useState<readonly string[] | undefined>(undefined);
  if (saved !== seed) {
    setSeed(saved);
    setDomains(saved ? [...saved] : null);
  }
  const dirty = Boolean(saved && domains && saved.join(',') !== domains.join(','));

  const add = () => {
    const parsed = emailDomainSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a domain');
      return;
    }
    if (domains?.includes(parsed.data)) {
      setError('Already in the list');
      return;
    }
    setDomains([...(domains ?? []), parsed.data]);
    setInput('');
    setError(null);
  };

  return (
    <SettingsCard
      title="Allowed email domains"
      description="Only people with these email domains can be invited. Leave empty to allow any domain."
      testId="domains-card"
      footer={
        <>
          <Button variant="ghost" disabled={!dirty} onClick={() => saved && setDomains([...saved])}>
            Discard
          </Button>
          <Button
            disabled={!dirty}
            loading={update.isPending}
            onClick={() =>
              domains && update.mutate({ allowedEmailDomains: domains }, { onSuccess: () => toast.success('Allowed domains saved') })
            }
            data-testid="domains-save"
          >
            Save domains
          </Button>
        </>
      }
    >
      {!domains ? (
        <SettingsSkeleton rows={1} />
      ) : (
        <div className="flex flex-col gap-3">
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-sm">
              <Input
                aria-label="Email domain"
                placeholder="example.com"
                value={input}
                invalid={Boolean(error)}
                aria-describedby={error ? 'domain-error' : undefined}
                leadingIcon={<span className="text-sm text-fg-muted">@</span>}
                onChange={(event) => {
                  setInput(event.target.value);
                  setError(null);
                }}
                data-testid="domain-input"
              />
              {error ? (
                <p id="domain-error" role="alert" className="text-sm text-danger-text">
                  {error}
                </p>
              ) : null}
            </div>
            <Button type="submit" variant="secondary" leadingIcon={<Plus aria-hidden />}>
              Add domain
            </Button>
          </form>
          {domains.length === 0 ? (
            <p className="text-sm text-fg-muted">Any email domain can be invited.</p>
          ) : (
            <ul aria-label="Allowed domains" className="flex flex-wrap gap-1.5">
              {domains.map((domain) => (
                <li key={domain} className="inline-flex h-7 items-center gap-1 rounded-full border border-border-subtle bg-muted pr-1 pl-3 text-sm text-fg">
                  @{domain}
                  <button
                    type="button"
                    aria-label={`Remove ${domain}`}
                    onClick={() => setDomains(domains.filter((entry) => entry !== domain))}
                    className="inline-flex size-5 items-center justify-center rounded-full text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

function IpAllowListCard() {
  const org = useOrgAdmin();
  const update = useUpdateOrgPolicy();
  const [text, setText] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const settings = org.data?.settings;
  const [seed, setSeed] = useState<typeof settings>(undefined);
  if (settings !== seed) {
    setSeed(settings);
    setText(settings ? settings.ipAllowList.join(NEWLINE) : null);
    setEnabled(settings ? settings.ipAllowListEnabled : null);
  }
  const rules = (text ?? '')
    .split(/[\n,]+/)
    .map((rule) => rule.trim())
    .filter(Boolean);
  const invalid = invalidIpRules(rules);
  const myIp = org.data?.requesterIp ?? null;
  const matches = myIp ? ipAllowed(myIp, rules) : null;
  const dirty = Boolean(
    settings && text !== null && (settings.ipAllowList.join('\n') !== rules.join('\n') || settings.ipAllowListEnabled !== enabled),
  );

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          IP allow-list
          {settings?.ipAllowListEnabled ? <Badge tone="success" icon={<ShieldCheck aria-hidden />}>Enforced</Badge> : <Badge>Off</Badge>}
        </span>
      }
      description="When on, API and app requests from addresses outside these ranges are blocked."
      testId="ip-card"
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              if (!settings) return;
              setText(settings.ipAllowList.join('\n'));
              setEnabled(settings.ipAllowListEnabled);
            }}
          >
            Discard
          </Button>
          <Button
            disabled={!dirty || invalid.length > 0}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { ipAllowList: rules, ipAllowListEnabled: Boolean(enabled) },
                { onSuccess: () => toast.success(enabled ? 'IP allow-list is on' : 'IP allow-list saved') },
              )
            }
            data-testid="ip-save"
          >
            Save allow-list
          </Button>
        </>
      }
    >
      {text === null || enabled === null ? (
        <SettingsSkeleton rows={2} />
      ) : (
        <>
          <SettingRow label="Enforce allow-list" description="We won’t let you turn it on if your current address isn’t covered.">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enforce IP allow-list" data-testid="ip-enabled" />
          </SettingRow>
          <SettingRow label="Allowed addresses" description="One IPv4/IPv6 address or CIDR range per line, e.g. 203.0.113.0/24.">
            <Textarea
              aria-label="Allowed IP addresses"
              rows={4}
              className="font-mono text-sm"
              value={text}
              invalid={invalid.length > 0}
              aria-describedby="ip-help"
              onChange={(event) => setText(event.target.value)}
              data-testid="ip-rules"
            />
            <p id="ip-help" className={cn('mt-1.5 text-sm', invalid.length ? 'text-danger-text' : 'text-fg-muted')} role={invalid.length ? 'alert' : undefined}>
              {invalid.length
                ? `Not a valid address or range: ${invalid.join(', ')}`
                : myIp
                  ? `Your address is ${myIp}${matches ? ' and it is covered.' : ' and it is not covered yet.'}`
                  : 'Your address isn’t visible to the server here (local network), so the check is skipped.'}
            </p>
          </SettingRow>
        </>
      )}
    </SettingsCard>
  );
}
