'use client';
/** Profile → Password & sessions: change password, my sessions (revoke one / all others), 2FA placeholder. */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Eye, EyeOff, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  ProgressBar,
  Switch,
  toast,
} from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { PASSWORD_POLICY } from '@/server/services/admin-contracts';
import { parseUserAgent } from '@/server/services/admin-policy';
import { formatDateTime, formatIp, passwordStrength, relativeTime } from '../format';
import { DemoBadge, ErrorPanel, SettingRow, SettingsCard, TableSkeleton } from '../ui';

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, bot: Bot, unknown: Monitor } as const;
const STRENGTH_TONE = { 0: 'danger', 1: 'danger', 2: 'warning', 3: 'primary', 4: 'success' } as const;
const MY_SESSIONS_KEY = ['me', 'sessions'] as const;

interface SessionRow {
  readonly id: string;
  readonly token: string;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
  readonly createdAt: Date | string;
  readonly updatedAt: Date | string;
}

function iso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export function SecurityTab() {
  return (
    <div className="flex flex-col gap-6" data-testid="profile-security">
      <ChangePasswordCard />
      <MySessionsCard />
      <SettingsCard title="Two-factor authentication" description="An extra code from an authenticator app when you sign in.">
        <SettingRow
          label={
            <span className="inline-flex items-center gap-2">
              Authenticator app <DemoBadge>Not available yet</DemoBadge>
            </span>
          }
          description="Placeholder: two-factor sign-in isn’t enabled in this build."
        >
          <Switch disabled checked={false} aria-label="Two-factor authentication (not available)" />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  autoComplete,
  testId,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly invalid: boolean;
  readonly describedBy?: string;
  readonly autoComplete: string;
  readonly testId?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      id={id}
      type={visible ? 'text' : 'password'}
      value={value}
      autoComplete={autoComplete}
      invalid={invalid}
      aria-describedby={describedBy}
      maxLength={PASSWORD_POLICY.maxLength}
      onChange={(event) => onChange(event.target.value)}
      data-testid={testId}
      trailing={
        <IconButton
          size="xs"
          hideTooltip
          label={visible ? 'Hide password' : 'Show password'}
          icon={visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          onClick={() => setVisible(!visible)}
        />
      }
    />
  );
}

function ChangePasswordCard() {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [pending, setPending] = useState(false);
  const strength = passwordStrength(next, PASSWORD_POLICY.minLength);

  const submit = async () => {
    const found: typeof errors = {};
    if (!current) found.current = 'Enter your current password';
    if (next.length < PASSWORD_POLICY.minLength) found.next = `Use at least ${PASSWORD_POLICY.minLength} characters`;
    else if (next === current) found.next = 'Choose a password you haven’t used here';
    if (confirm !== next) found.confirm = 'Passwords don’t match';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revokeOthers,
      });
      if (result.error) {
        const message = result.error.message ?? 'Could not change your password';
        if (/password/i.test(message) && /invalid|incorrect/i.test(message)) setErrors({ current: 'That password isn’t correct' });
        else toast.error('Password not changed', message);
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed', revokeOthers ? 'Your other sessions were signed out.' : undefined);
      void queryClient.invalidateQueries({ queryKey: MY_SESSIONS_KEY });
    } catch {
      toast.error('Password not changed', 'Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsCard
      title="Change password"
      description={`${PASSWORD_POLICY.minLength} to ${PASSWORD_POLICY.maxLength} characters. A mix of words, numbers and symbols is strongest.`}
      testId="change-password"
      footer={
        <Button loading={pending} onClick={() => void submit()} data-testid="password-submit">
          Update password
        </Button>
      }
    >
      <form
        className="grid max-w-md gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input type="text" autoComplete="username" className="hidden" aria-hidden tabIndex={-1} readOnly />
        <Field label="Current password" error={errors.current}>
          {({ inputId, describedBy, invalid }) => (
            <PasswordInput id={inputId} value={current} onChange={setCurrent} invalid={invalid} describedBy={describedBy} autoComplete="current-password" testId="password-current" />
          )}
        </Field>
        <Field label="New password" error={errors.next}>
          {({ inputId, describedBy, invalid }) => (
            <div className="flex flex-col gap-1.5">
              <PasswordInput id={inputId} value={next} onChange={setNext} invalid={invalid} describedBy={describedBy} autoComplete="new-password" testId="password-new" />
              {next ? (
                <div className="flex items-center gap-2" aria-live="polite">
                  <ProgressBar
                    size="sm"
                    className="flex-1"
                    label="Password strength"
                    value={(strength.score / 4) * 100}
                    tone={STRENGTH_TONE[strength.score]}
                  />
                  <span className="w-16 text-right text-xs font-medium text-fg-secondary">{strength.label}</span>
                </div>
              ) : null}
            </div>
          )}
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          {({ inputId, describedBy, invalid }) => (
            <PasswordInput id={inputId} value={confirm} onChange={setConfirm} invalid={invalid} describedBy={describedBy} autoComplete="new-password" testId="password-confirm" />
          )}
        </Field>
        <Checkbox
          checked={revokeOthers}
          onCheckedChange={(value) => setRevokeOthers(value === true)}
          label="Sign out of all other devices"
          description="Recommended if you think someone else knows your password."
        />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </SettingsCard>
  );
}

function MySessionsCard() {
  const queryClient = useQueryClient();
  const current = authClient.useSession();
  const sessions = useQuery({
    queryKey: MY_SESSIONS_KEY,
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error(result.error.message ?? 'Could not load sessions');
      return (result.data ?? []) as SessionRow[];
    },
  });
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const currentId = current.data?.session.id;
  const list = [...(sessions.data ?? [])].sort((a, b) => iso(b.updatedAt).localeCompare(iso(a.updatedAt)));
  const others = list.filter((entry) => entry.id !== currentId);

  const revoke = async (entry: SessionRow) => {
    setBusy(entry.id);
    const saved = sessions.data;
    queryClient.setQueryData<SessionRow[]>(MY_SESSIONS_KEY, (rows) => rows?.filter((row) => row.id !== entry.id));
    const result = await authClient.revokeSession({ token: entry.token }).catch(() => ({ error: { message: 'Network error' } }));
    setBusy(null);
    if (result.error) {
      queryClient.setQueryData(MY_SESSIONS_KEY, saved);
      toast.error('Could not sign out that session', result.error.message ?? undefined);
    } else toast.success('Session signed out');
  };

  const revokeAll = async () => {
    setConfirmAll(false);
    setBusy('all');
    const result = await authClient.revokeOtherSessions().catch(() => ({ error: { message: 'Network error' } }));
    setBusy(null);
    if (result.error) toast.error('Could not sign out other sessions', result.error.message ?? undefined);
    else toast.success('Signed out of all other sessions');
    void queryClient.invalidateQueries({ queryKey: MY_SESSIONS_KEY });
  };

  return (
    <SettingsCard
      title="Where you’re signed in"
      description="Sign out of devices you don’t recognize."
      padded={false}
      testId="my-sessions"
      aside={
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<LogOut aria-hidden />}
          disabled={others.length === 0}
          loading={busy === 'all'}
          onClick={() => setConfirmAll(true)}
          data-testid="sessions-revoke-others"
        >
          Sign out all other sessions
        </Button>
      }
    >
      {sessions.isPending ? (
        <TableSkeleton rows={3} columns={2} />
      ) : sessions.isError ? (
        <ErrorPanel title="Couldn't load your sessions" onRetry={() => void sessions.refetch()} />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {list.map((entry) => {
            const device = parseUserAgent(entry.userAgent);
            const Icon = DEVICE_ICON[device.kind];
            const isCurrent = entry.id === currentId;
            return (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-hover" data-testid="my-session-row">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-icon">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-fg">
                      {device.browser} on {device.os}
                    </span>
                    {isCurrent ? <Badge tone="success" size="sm">This device</Badge> : null}
                  </span>
                  <span className="block truncate text-sm text-fg-muted" title={`Signed in ${formatDateTime(iso(entry.createdAt))}`}>
                    {entry.ipAddress ? formatIp(entry.ipAddress) : 'Unknown IP'} · Active {relativeTime(iso(entry.updatedAt))}
                  </span>
                </span>
                {isCurrent ? null : (
                  <Button size="sm" variant="ghost" loading={busy === entry.id} onClick={() => void revoke(entry)}>
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        destructive
        title="Sign out of all other sessions?"
        description={`You’ll stay signed in here. ${others.length} other ${others.length === 1 ? 'session' : 'sessions'} will need to sign in again.`}
        confirmLabel="Sign out others"
        onConfirm={() => void revokeAll()}
      />
    </SettingsCard>
  );
}
