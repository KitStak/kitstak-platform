'use client';
import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import {
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Select,
  toast,
} from '@/components/ui';
import { organization } from '@/lib/auth-client';
import { useOrg } from '../org-context';

const emailSchema = z.email();
const MAX_INVITES = 50;

type InviteRole = 'admin' | 'member' | 'viewer' | 'guest';

const ROLE_OPTIONS: readonly { value: InviteRole; label: string; description: string }[] = [
  { value: 'member', label: 'Member', description: 'Create and edit boards' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access' },
  { value: 'guest', label: 'Guest', description: 'Only boards shared with them' },
  { value: 'admin', label: 'Admin', description: 'Manage members and settings' },
];

function isInviteRole(value: string): value is InviteRole {
  return ROLE_OPTIONS.some((option) => option.value === value);
}

function splitEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export interface InviteDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Invite teammates by email with a role. Emails are validated client side and by the server. */
export function InviteDialog({ open, onOpenChange }: InviteDialogProps) {
  const { org, role: myRole } = useOrg();
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const roleOptions = ROLE_OPTIONS.filter(
    (option) => option.value !== 'admin' || myRole === 'owner' || myRole === 'admin',
  );

  const commit = (raw: string) => {
    const parts = splitEmails(raw);
    if (parts.length === 0) return;
    const invalid = parts.filter((email) => !emailSchema.safeParse(email).success);
    const valid = parts.filter((email) => emailSchema.safeParse(email).success);
    setEmails((current) =>
      [...current, ...valid.filter((email) => !current.includes(email))].slice(0, MAX_INVITES),
    );
    setDraft(invalid.join(' '));
    setError(
      invalid.length
        ? `${invalid.length === 1 ? 'This address is' : 'These addresses are'} not valid: ${invalid.join(', ')}`
        : null,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ' || event.key === 'Tab') {
      if (!draft.trim()) return;
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && !draft && emails.length) {
      setEmails((current) => current.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    commit(`${draft} ${event.clipboardData.getData('text')}`);
  };

  const reset = () => {
    setEmails([]);
    setDraft('');
    setRole('member');
    setError(null);
  };

  const send = async () => {
    const pending = draft.trim()
      ? [...emails, ...splitEmails(draft).filter((email) => emailSchema.safeParse(email).success)]
      : emails;
    const unique = Array.from(new Set(pending));
    if (unique.length === 0) {
      setError('Add at least one email address.');
      return;
    }
    setSending(true);
    setError(null);
    const results = await Promise.allSettled(
      unique.map(async (email) => {
        const result = await organization.inviteMember({ email, role, organizationId: org.id });
        if (result.error) throw new Error(result.error.message ?? `Couldn't invite ${email}`);
        return email;
      }),
    );
    setSending(false);
    const failed = results.flatMap((result, index) =>
      result.status === 'rejected' ? [unique[index] ?? ''] : [],
    );
    const sent = unique.length - failed.length;
    if (sent > 0) toast.success(sent === 1 ? 'Invitation sent' : `${sent} invitations sent`);
    if (failed.length > 0) {
      const firstError = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      setEmails(failed);
      setDraft('');
      setError(
        firstError?.reason instanceof Error
          ? `${failed.length} not sent: ${firstError.reason.message}`
          : `${failed.length} invitations could not be sent.`,
      );
      return;
    }
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) reset();
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          title={`Invite to ${org.name}`}
          description="Invitations expire in 7 days."
          icon={
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
              <UserPlus aria-hidden className="size-[18px]" />
            </span>
          }
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-emails" className="text-sm font-semibold text-fg-secondary">
              Email addresses
            </label>
            <div
              className="flex min-h-20 flex-wrap content-start gap-1.5 rounded-sm border border-border-input bg-panel p-2 transition-[border-color,box-shadow] focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] hover:border-border-input-hover"
              onClick={() => document.getElementById('invite-emails')?.focus()}
            >
              {emails.map((email) => (
                <Chip
                  key={email}
                  color="blue"
                  removeLabel="Remove"
                  onRemove={() => setEmails((current) => current.filter((e) => e !== email))}
                >
                  {email}
                </Chip>
              ))}
              <input
                id="invite-emails"
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => draft.trim() && commit(draft)}
                placeholder={emails.length ? '' : 'name@company.com, another@company.com'}
                aria-describedby="invite-hint"
                className="h-6 min-w-[180px] flex-1 bg-transparent text-base outline-none"
                inputMode="email"
                autoComplete="off"
              />
            </div>
            <p id="invite-hint" className="text-sm text-fg-muted">
              Separate addresses with commas or spaces. Paste a list to add many at once.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="invite-role-label" className="text-sm font-semibold text-fg-secondary">
              Role
            </span>
            <Select
              aria-label="Role"
              value={role}
              onValueChange={(value) => {
                if (isInviteRole(value)) setRole(value);
              }}
              options={roleOptions}
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void send()}
            loading={sending}
            disabled={emails.length === 0 && !draft.trim()}
          >
            {emails.length > 1 ? `Send ${emails.length} invitations` : 'Send invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
