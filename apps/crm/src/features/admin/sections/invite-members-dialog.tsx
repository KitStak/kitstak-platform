'use client';
/** Invite people by email (paste many at once) with a role picker. */
import { useState } from 'react';
import { CircleAlert, MailPlus, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Select,
  Textarea,
  Tooltip,
  toast,
} from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { canManageRole, ORG_ROLES, type OrgRole } from '@/server/rbac/permissions';
import { useInviteMembers } from '../api';
import { parseEmailList, ROLE_DESCRIPTION, ROLE_LABEL } from '../format';

export function InviteMembersDialog({
  open,
  onOpenChange,
  allowedDomains,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly allowedDomains: readonly string[];
}) {
  const { role: actorRole } = useOrg();
  const invite = useInviteMembers();
  const [text, setText] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [error, setError] = useState<string | null>(null);
  const { valid, invalid } = parseEmailList(text);

  const close = (next: boolean) => {
    if (!next) {
      setText('');
      setError(null);
    }
    onOpenChange(next);
  };

  const removeAddress = (email: string) => {
    const current = parseEmailList(text);
    setText([...current.valid, ...current.invalid].filter((entry) => entry !== email).join(', '));
  };

  const submit = () => {
    if (valid.length === 0) {
      setError('Add at least one email address');
      return;
    }
    if (invalid.length > 0) {
      setError(`Fix ${invalid.length === 1 ? 'this address' : 'these addresses'}: ${invalid.join(', ')}`);
      return;
    }
    setError(null);
    invite.mutate(
      { emails: valid, role },
      {
        onSuccess: (results) => {
          const sent = results.filter((entry) => entry.ok);
          const failed = results.filter((entry) => !entry.ok);
          if (sent.length > 0) toast.success(`${sent.length} invitation${sent.length === 1 ? '' : 's'} sent`);
          if (failed.length > 0) {
            setText(failed.map((entry) => entry.email).join(', '));
            setError(failed.map((entry) => `${entry.email}: ${entry.reason}`).join(' · '));
          } else close(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md" data-testid="invite-dialog">
        <DialogHeader
          title="Invite people"
          description="Invitations expire after 7 days."
          icon={
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
              <MailPlus aria-hidden className="size-5" />
            </span>
          }
        />
        <DialogBody className="flex flex-col gap-4 pb-4">
          <Field
            label="Email addresses"
            error={error}
            hint={
              allowedDomains.length
                ? `Only ${allowedDomains.map((domain) => `@${domain}`).join(', ')} addresses are allowed.`
                : 'Separate several addresses with commas, spaces or new lines.'
            }
          >
            {({ inputId, describedBy, invalid: isInvalid }) => (
              <Textarea
                id={inputId}
                aria-describedby={describedBy}
                invalid={isInvalid}
                rows={3}
                autoFocus
                placeholder="name@company.com, teammate@company.com"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
                }}
                data-testid="invite-emails"
              />
            )}
          </Field>
          {valid.length + invalid.length > 0 ? (
            <ul aria-label="Recipients" className="flex flex-wrap gap-1.5" data-testid="invite-chips">
              {valid.map((email) => (
                <li key={email} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-sm text-fg">
                  {email}
                  <RemoveChip email={email} onRemove={() => removeAddress(email)} />
                </li>
              ))}
              {invalid.map((email) => (
                <li key={`invalid-${email}`}>
                  <Tooltip content="Not a valid email address">
                    <span
                      tabIndex={0}
                      data-testid="invite-chip-invalid"
                      aria-label={`${email}: not a valid email address`}
                      className="inline-flex h-6 items-center gap-1 rounded-full bg-danger-subtle pr-1 pl-2 text-sm text-danger-text ring-1 ring-danger focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <CircleAlert aria-hidden className="size-3.5" />
                      {email}
                      <RemoveChip email={email} onRemove={() => removeAddress(email)} />
                    </span>
                  </Tooltip>
                </li>
              ))}
            </ul>
          ) : null}
          <Field label="Role" hint={ROLE_DESCRIPTION[role]}>
            {({ inputId, describedBy }) => (
              <Select
                id={inputId}
                aria-describedby={describedBy}
                value={role}
                onValueChange={(value) => setRole(value as OrgRole)}
                options={ORG_ROLES.map((entry) => ({
                  value: entry,
                  label: ROLE_LABEL[entry],
                  disabled: !canManageRole(actorRole, entry),
                }))}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={invite.isPending}
            disabled={valid.length === 0 || invalid.length > 0}
            data-testid="invite-submit"
          >
            {invalid.length > 0
              ? `Fix ${invalid.length} ${invalid.length === 1 ? 'address' : 'addresses'}`
              : valid.length > 1
                ? `Send ${valid.length} invitations`
                : 'Send invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveChip({ email, onRemove }: { readonly email: string; readonly onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${email}`}
      className="inline-flex size-4 items-center justify-center rounded-full text-current opacity-70 hover:bg-hover hover:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
      onClick={onRemove}
    >
      <X aria-hidden className="size-3" />
    </button>
  );
}
