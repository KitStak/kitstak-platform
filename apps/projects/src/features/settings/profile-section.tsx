'use client';
/** Settings → Profile: who you are in this workspace, what lands in your inbox and email digests. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar, Badge, Button, Checkbox, Field, Input, Switch, toast } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { Panel } from '@/components/layout/page';
import type { NotificationKind } from '@/lib/constants';
import { updatePrefsAction } from '@/server/actions/prefs';
import { useShell } from '@/features/shell/shell-context';

const NOTIFICATION_GROUPS: readonly {
  title: string;
  items: readonly { kind: NotificationKind; label: string; description: string }[];
}[] = [
  {
    title: 'Work for you',
    items: [
      { kind: 'assigned', label: 'Assigned to me', description: 'Someone gives you a task.' },
      { kind: 'mention', label: 'Mentions', description: 'Someone writes @your name in a comment.' },
      { kind: 'due_soon', label: 'Due soon', description: 'Your task is due today or tomorrow.' },
      { kind: 'overdue', label: 'Overdue', description: 'Your task is past its due date.' },
    ],
  },
  {
    title: 'Tasks you follow',
    items: [
      { kind: 'comment', label: 'New comments', description: 'Someone comments on a task you follow.' },
      {
        kind: 'status_changed',
        label: 'Status changes',
        description: 'A task you follow moves to a new step.',
      },
      {
        kind: 'watching',
        label: 'Other changes',
        description: 'Dates, priority or the assignee change on tasks you follow.',
      },
    ],
  },
  {
    title: 'Projects and apps',
    items: [
      {
        kind: 'project',
        label: 'Project updates',
        description: 'You’re added to a project, its health changes, or a form gets a response.',
      },
      { kind: 'automation', label: 'Automations', description: 'Rules that send you a heads-up.' },
      { kind: 'integration', label: 'CRM and WMS', description: 'Linked deals and orders change.' },
    ],
  },
];

const ROLE_WORDS: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

export function ProfileSection({
  notificationPrefs,
}: {
  readonly notificationPrefs: Partial<Record<NotificationKind, boolean>>;
}) {
  const router = useRouter();
  const { user, org, orgRole } = useShell();
  const [prefs, setPrefs] = useState(notificationPrefs);
  const [name, setName] = useState(user.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const saveName = async () => {
    const next = name.trim();
    if (!next) {
      setNameError('Enter your name.');
      return;
    }
    if (next === user.name) return;
    setNameError(null);
    setSavingName(true);
    try {
      const result = await authClient.updateUser({ name: next });
      if (result.error) {
        toast.error("Couldn't change your name", result.error.message ?? 'Please try again.');
        return;
      }
      toast.success('Name saved', 'Teammates will see it everywhere in KitStak.');
      router.refresh();
    } catch {
      toast.error("Couldn't change your name", 'Check your connection and try again.');
    } finally {
      setSavingName(false);
    }
  };

  const setPref = async (kind: NotificationKind, on: boolean) => {
    const before = prefs;
    const next = { ...prefs, [kind]: on };
    setPrefs(next);
    const result = await updatePrefsAction({ notifications: next });
    if (!result.ok) {
      setPrefs(before);
      toast.error("Couldn't save that setting", result.error.message);
    }
  };
  const allOn = NOTIFICATION_GROUPS.every((group) => group.items.every((item) => prefs[item.kind] !== false));
  const setAll = async (on: boolean) => {
    const before = prefs;
    const next = Object.fromEntries(
      NOTIFICATION_GROUPS.flatMap((group) => group.items.map((item) => [item.kind, on])),
    );
    setPrefs(next);
    const result = await updatePrefsAction({ notifications: next });
    if (!result.ok) {
      setPrefs(before);
      toast.error("Couldn't save that setting", result.error.message);
    } else
      toast.success(
        on ? 'Everything turned on' : 'Inbox is quiet now',
        on ? undefined : 'You can still find all your work in My work.',
      );
  };

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Your profile">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar name={name || user.name} src={user.image} size="xl" />
          <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
            <Field label="Your name" error={nameError ?? undefined}>
              {({ inputId, invalid }) => (
                <Input
                  id={inputId}
                  value={name}
                  maxLength={80}
                  invalid={invalid}
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveName();
                  }}
                  data-testid="profile-name"
                />
              )}
            </Field>
            <Field label="Email" hint="Used to sign in to every KitStak app.">
              {({ inputId, describedBy }) => (
                <Input id={inputId} aria-describedby={describedBy} value={user.email} readOnly disabled />
              )}
            </Field>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg-secondary sm:col-span-2">
              <Badge tone="neutral">{ROLE_WORDS[orgRole] ?? orgRole}</Badge> in {org.name}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => void saveName()}
            loading={savingName}
            disabled={name.trim() === user.name || !name.trim()}
            data-testid="profile-save"
          >
            Save name
          </Button>
        </div>
      </Panel>

      <PasswordPanel />

      <Panel
        title="Inbox notifications"
        action={
          <button
            type="button"
            onClick={() => void setAll(!allOn)}
            className="text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {allOn ? 'Turn all off' : 'Turn all on'}
          </button>
        }
      >
        <div className="flex flex-col gap-5">
          {NOTIFICATION_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                {group.title}
              </h3>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {group.items.map((item) => (
                  <li key={item.kind} className="flex items-center justify-between gap-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-fg">{item.label}</p>
                      <p className="text-xs text-fg-muted">{item.description}</p>
                    </div>
                    <Switch
                      checked={prefs[item.kind] !== false}
                      onCheckedChange={(on) => void setPref(item.kind, on)}
                      aria-label={item.label}
                      data-testid={`notify-${item.kind}`}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

const MIN_PASSWORD = 8;

function PasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [pending, setPending] = useState(false);
  const submit = async () => {
    const found: typeof errors = {};
    if (!current) found.current = 'Enter your current password.';
    if (next.length < MIN_PASSWORD) found.next = `Use at least ${MIN_PASSWORD} characters.`;
    else if (next === current) found.next = 'Pick a password different from the current one.';
    if (confirm !== next) found.confirm = 'The two new passwords don’t match.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setPending(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: signOutOthers,
      });
      if (result.error) {
        const message = result.error.message ?? 'Please try again.';
        if (/password/i.test(message) && /invalid|incorrect/i.test(message))
          setErrors({ current: 'That password isn’t right.' });
        else toast.error('Password not changed', message);
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(
        'Password changed',
        signOutOthers ? 'You were signed out on your other devices.' : undefined,
      );
    } catch {
      toast.error('Password not changed', 'Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };
  return (
    <Panel title="Password">
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Current password" error={errors.current}>
          {({ inputId, invalid }) => (
            <Input
              id={inputId}
              type="password"
              autoComplete="current-password"
              value={current}
              invalid={invalid}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="New password"
          error={errors.next}
          hint={errors.next ? undefined : `At least ${MIN_PASSWORD} characters.`}
        >
          {({ inputId, invalid, describedBy }) => (
            <Input
              id={inputId}
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy}
              value={next}
              invalid={invalid}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field label="New password again" error={errors.confirm}>
          {({ inputId, invalid }) => (
            <Input
              id={inputId}
              type="password"
              autoComplete="new-password"
              value={confirm}
              invalid={invalid}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-3 sm:col-span-3 sm:flex-row sm:items-center sm:justify-between">
          <Checkbox
            checked={signOutOthers}
            onCheckedChange={(checked) => setSignOutOthers(checked === true)}
            label="Sign me out on my other devices"
          />
          <Button
            type="submit"
            variant="secondary"
            loading={pending}
            disabled={!current || !next || !confirm}
          >
            Change password
          </Button>
        </div>
      </form>
    </Panel>
  );
}
