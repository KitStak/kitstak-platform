'use client';

/**
 * User side panels: Show details (profile, roles, warehouse and client access, recent
 * activity), Sessions (each live session with Revoke, plus Revoke all) and the one-time
 * temporary password dialog shown after Reset Password.
 */
import * as React from 'react';
import { Copy, KeyRound, Laptop, LogOut, Pencil, Smartphone } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { useFormat } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import type { UserDetail, UserRow, UserSession } from '@/server/repositories/users';
import { UnderlineTabs } from '@/components/ui/tabs';
import { ChangeLogList, DetailList, NO_PERMISSION, StatRow, useAction } from '../admin-shared';

/**
 * Grid row → provisional detail, so Show details paints the profile at once (no skeleton
 * flash) while `/api/users/:id` loads the role, warehouse and client lists.
 */
export function detailFromRow(row: UserRow): UserDetail {
  const split = (v: string | null) =>
    (v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const roles = split(row.roleNames).map((name) => ({ id: name, name, key: '', isSystem: false }));
  const warehouses = split(row.warehouseCodes).map((code) => ({ id: code, code, name: code }));
  return { ...row, roles, warehouses, clients: [], roleIds: [], warehouseIds: [], clientIds: [] };
}

export function UserDetailDrawer({
  id,
  seed,
  onOpenChange,
  onEdit,
  onSessions,
  canEdit,
}: {
  readonly id: string | null;
  readonly seed?: UserRow | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly onEdit: (id: string) => void;
  readonly onSessions: (id: string) => void;
  readonly canEdit: boolean;
}) {
  const fmt = useFormat();
  const placeholder = React.useMemo(
    () => (seed && seed.id === id ? { data: detailFromRow(seed) } : undefined),
    [seed, id],
  );
  const q = useApiQuery<UserDetail>(['user', id ?? ''], id ? `/api/users/${id}` : null, {
    staleTime: 0,
    placeholderData: placeholder,
  });
  const d = q.data?.data;
  const provisional = q.isPlaceholderData;
  const [tab, setTab] = React.useState<'details' | 'access' | 'sessions' | 'log'>('details');
  const sessionsQ = useApiQuery<readonly UserSession[]>(
    ['user-sessions', id ?? ''],
    id && tab === 'sessions' ? `/api/users/${id}/sessions` : null,
    { staleTime: 0 },
  );
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(o) => {
        if (!o) setTab('details');
        onOpenChange(o);
      }}
      width={45}
      title={d ? d.name : 'User'}
      description={d?.email ?? 'User details'}
      footer={
        d ? (
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => onSessions(d.id)}>
              <Laptop className="h-4 w-4" aria-hidden />
              Manage sessions ({d.activeSessions})
            </Button>
            <DisabledReason reason={canEdit ? null : NO_PERMISSION}>
              <Button variant="primary" disabled={!canEdit} onClick={() => onEdit(d.id)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            </DisabledReason>
          </div>
        ) : undefined
      }
    >
      {q.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : q.isError || !d ? (
        <EmptyState
          title="Couldn't load this user"
          description={q.error?.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar name={d.name} size="lg" tone="brand" />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-base font-semibold text-foreground">
                {d.name}
                <StatusPill status={d.status} size="sm" />
              </p>
              <p className="truncate text-xs text-faint">{d.email}</p>
            </div>
          </div>
          <StatRow
            stats={[
              { label: 'Roles', value: d.roles.length },
              { label: 'Warehouses', value: d.warehouses.length },
              { label: 'Clients', value: d.allClients ? 'All' : provisional ? '…' : d.clients.length },
              {
                label: 'Live sessions',
                value: d.activeSessions,
                tone: d.activeSessions > 0 ? 'success' : undefined,
              },
            ]}
          />
          <UnderlineTabs
            ariaLabel="User detail sections"
            className="-mx-6"
            active={tab}
            onChange={(k) => setTab(k as typeof tab)}
            tabs={[
              { key: 'details', label: 'Details' },
              { key: 'access', label: 'Access' },
              { key: 'sessions', label: 'Sessions', count: d.activeSessions },
              { key: 'log', label: 'Change log' },
            ]}
          />
          {tab === 'details' ? (
            <DetailList
              title="Profile"
              items={[
                { label: 'First name', value: d.firstName },
                { label: 'Last name', value: d.lastName },
                { label: 'User type', value: d.userType },
                { label: 'API user', value: d.isApiUser ? 'Yes' : 'No' },
                {
                  label: 'Last sign-in',
                  value: d.lastLoginAt ? fmt.gridDateTime(d.lastLoginAt) : 'Never signed in',
                },
                {
                  label: 'Password changed',
                  value: d.passwordChangedAt ? (
                    fmt.gridDateTime(d.passwordChangedAt)
                  ) : (
                    <Badge tone="warning">Change required at next sign-in</Badge>
                  ),
                },
                {
                  label: 'Locked until',
                  value:
                    d.lockedUntil && d.lockedUntil > new Date().toISOString()
                      ? fmt.gridDateTime(d.lockedUntil)
                      : 'Not locked',
                },
                { label: 'Member since', value: fmt.date(d.createdAt) },
              ]}
            />
          ) : null}
          {tab === 'access' ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-secondary">Access</h3>
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                <AccessRow label="Roles" values={d.roles.map((r) => r.name)} />
                <AccessRow label="Warehouses" values={d.warehouses.map((w) => w.name)} />
                <AccessRow
                  label="Clients"
                  values={
                    d.allClients
                      ? ['All existing and future clients']
                      : provisional
                        ? ['Loading…']
                        : d.clients.map((c) => c.name)
                  }
                />
              </div>
            </section>
          ) : null}
          {tab === 'sessions' ? (
            sessionsQ.isPending ? (
              <SkeletonTable rows={2} columns={2} />
            ) : sessionsQ.isError ? (
              <EmptyState
                title="Couldn't load sessions"
                description={sessionsQ.error.message}
                action={<Button onClick={() => void sessionsQ.refetch()}>Retry</Button>}
                compact
              />
            ) : (sessionsQ.data?.data ?? []).length === 0 ? (
              <EmptyState
                icon={Laptop}
                title="No live sessions"
                description="This user isn't signed in on any device."
                compact
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {(sessionsQ.data?.data ?? []).map((sess) => (
                  <li key={sess.id} className="px-3 py-2.5">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {deviceOf(sess.userAgent).label}
                      {sess.isCurrent ? <Badge tone="success">This device</Badge> : null}
                    </p>
                    <p className="text-2xs text-faint">
                      {sess.ip ?? 'Unknown IP'} · signed in {fmt.gridDateTime(sess.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {tab === 'log' ? <ChangeLogList key={d.id} path={`/api/users/${d.id}/change-log`} /> : null}
        </div>
      )}
    </Drawer>
  );
}

function AccessRow({ label, values }: { readonly label: string; readonly values: readonly string[] }) {
  return (
    <div className="grid grid-cols-[100px_minmax(0,1fr)] items-start gap-2">
      <span className="pt-0.5 text-2xs text-faint">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.length ? (
          values.map((v) => (
            <Badge key={v} tone="info">
              {v}
            </Badge>
          ))
        ) : (
          <span className="text-faint">None</span>
        )}
      </div>
    </div>
  );
}

function deviceOf(userAgent: string | null): { label: string; mobile: boolean } {
  const ua = userAgent ?? '';
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : ua
            ? 'Browser'
            : 'Unknown device';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

export function UserSessionsDrawer({
  user,
  onOpenChange,
  canEdit,
  onChanged,
}: {
  readonly user: { readonly id: string; readonly name: string } | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly canEdit: boolean;
  readonly onChanged: () => void;
}) {
  const fmt = useFormat();
  const q = useApiQuery<readonly UserSession[]>(
    ['user-sessions', user?.id ?? ''],
    user ? `/api/users/${user.id}/sessions` : null,
    { staleTime: 0 },
  );
  const action = useAction([
    ['user-sessions', user?.id ?? ''],
    ['grid', 'users'],
    ['user', user?.id ?? ''],
  ]);
  const [revokeAll, setRevokeAll] = React.useState(false);
  const rows = q.data?.data ?? [];
  const revoke = async (sessionId: string) => {
    if (!user) return;
    const res = await action.run<{ revoked: boolean }>(
      `/api/users/${user.id}/sessions/${sessionId}`,
      'DELETE',
    );
    if (res) {
      toast.success('Session revoked', `${user.name} is signed out on that device at their next click.`);
      onChanged();
    }
  };
  return (
    <Drawer
      open={user !== null}
      onOpenChange={onOpenChange}
      width={45}
      title={`Sessions · ${user?.name ?? ''}`}
      description="Revoking a session signs it out on its next request."
      footer={
        rows.length > 0 ? (
          <div className="flex justify-end">
            <DisabledReason reason={canEdit ? null : NO_PERMISSION}>
              <Button
                variant="danger"
                disabled={!canEdit || action.pending}
                onClick={() => setRevokeAll(true)}
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Revoke all sessions
              </Button>
            </DisabledReason>
          </div>
        ) : undefined
      }
    >
      {q.isPending ? (
        <SkeletonTable rows={3} columns={3} />
      ) : q.isError ? (
        <EmptyState
          title="Couldn't load sessions"
          description={q.error.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
          compact
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Laptop}
          title="No live sessions"
          description="This user isn't signed in on any device."
          compact
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((sess) => {
            const device = deviceOf(sess.userAgent);
            const Icon = device.mobile ? Smartphone : Laptop;
            return (
              <li key={sess.id} className="flex items-center gap-3 px-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {device.label}
                    {sess.isCurrent ? <Badge tone="success">This device</Badge> : null}
                  </p>
                  <p className="text-2xs text-faint">
                    {sess.ip ?? 'Unknown IP'} · signed in {fmt.gridDateTime(sess.createdAt)} · last active{' '}
                    {sess.lastSeenAt
                      ? fmt.age(sess.lastSeenAt) === 'now'
                        ? 'just now'
                        : `${fmt.age(sess.lastSeenAt)} ago`
                      : 'None'}
                  </p>
                </div>
                <DisabledReason
                  reason={
                    !canEdit
                      ? NO_PERMISSION
                      : sess.isCurrent
                        ? 'Use Log out to end your current session'
                        : null
                  }
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canEdit || sess.isCurrent || action.pending}
                    onClick={() => void revoke(sess.id)}
                  >
                    Revoke
                  </Button>
                </DisabledReason>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={revokeAll}
        onOpenChange={setRevokeAll}
        variant="danger"
        title={`Revoke every session of ${user?.name ?? 'this user'}?`}
        description="They are signed out on every device at their next click and must sign in again."
        confirmLabel="Yes, revoke all"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'device', label: 'Device' },
            { key: 'ip', label: 'IP address' },
          ],
          rows: rows.map((r) => ({ device: deviceOf(r.userAgent).label, ip: r.ip ?? 'None' })),
        }}
        onConfirm={async () => {
          if (!user) return;
          const res = await action.run<{ revoked: number }>(`/api/users/${user.id}/sessions`, 'DELETE');
          if (res) {
            toast.success(
              'Sessions revoked',
              `${res.revoked} session${res.revoked === 1 ? '' : 's'} ended for ${user.name}.`,
            );
            onChanged();
          }
          setRevokeAll(false);
        }}
      />
    </Drawer>
  );
}

export function TemporaryPasswordDialog({
  value,
  onClose,
}: {
  readonly value: { readonly email: string; readonly temporaryPassword: string } | null;
  readonly onClose: () => void;
}) {
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.temporaryPassword);
      toast.success('Copied', 'Temporary password copied to the clipboard.');
    } catch {
      toast.error("Couldn't copy", 'Select the password and copy it manually.');
    }
  };
  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          title="Temporary password"
          description={`Share it with ${value?.email ?? 'the user'} privately. It is shown only once.`}
        />
        <DialogBody className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
            <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <code className="flex-1 select-all font-mono text-base tracking-wide text-foreground">
              {value?.temporaryPassword}
            </code>
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </Button>
          </div>
          <p className="text-xs text-secondary">
            Every session of this user was signed out. Their password is marked as expired, so they must
            choose a new one after signing in.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
