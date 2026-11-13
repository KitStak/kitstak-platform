'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { Button, Field, Input, cn } from '@/components/ui';
import { organization } from '@/lib/auth-client';

const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

const emailSchema = z.email('Enter a valid email address.');

/** `orgId` is passed explicitly: portal sessions don't always carry an active organization. */
export function InviteMemberForm({ orgId }: { readonly orgId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }
    setError(null);
    setSent(false);
    setPending(true);
    try {
      const result = await organization.inviteMember({ email: parsed.data, role, organizationId: orgId });
      if (result.error) {
        setError(result.error.message ?? 'We couldn’t send the invitation. Try again.');
        return;
      }
      setEmail('');
      setSent(true);
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex-1">
        <Field label="Email" error={error} hint={sent ? 'Invitation created.' : undefined}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@company.com"
              leadingIcon={<Mail aria-hidden />}
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
      </div>
      <div className="w-full sm:w-36">
        <Field label="Role">
          {({ inputId }) => (
            <select
              id={inputId}
              value={role}
              onChange={(event) => setRole(event.target.value as InviteRole)}
              className={cn(
                'h-8 w-full rounded-md border border-border-input bg-panel px-2 text-sm text-fg capitalize',
                'hover:border-border-input-hover focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] focus:outline-none',
              )}
            >
              {INVITE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Button type="submit" loading={pending} className="sm:mt-[22px]">
        Send invite
      </Button>
    </form>
  );
}
