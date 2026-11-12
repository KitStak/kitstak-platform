'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { organization } from '@/lib/auth-client';

const NAME_MIN = 2;
const NAME_MAX = 80;

export function OrgProfileForm({
  orgId,
  name,
  slug,
  canManage,
}: {
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setError(`Use ${NAME_MIN}–${NAME_MAX} characters.`);
      return;
    }
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const result = await organization.update({ organizationId: orgId, data: { name: trimmed } });
      if (result.error) {
        setError(result.error.message ?? 'We couldn’t save the name. Try again.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 sm:max-w-md">
      <Field label="Organization name" error={error} hint={saved ? 'Saved.' : undefined}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            size="lg"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            readOnly={!canManage}
            aria-describedby={describedBy}
            invalid={invalid}
            trailing={canManage ? undefined : <Lock aria-hidden className="size-3.5" />}
            title={canManage ? undefined : 'Read-only — only owners and admins can edit'}
          />
        )}
      </Field>
      <Field
        label="Slug"
        hint="Identifies this organization across every KitStak app. Slugs can’t be changed here."
      >
        {({ inputId, describedBy }) => (
          <Input
            id={inputId}
            size="lg"
            value={slug}
            readOnly
            aria-describedby={describedBy}
            trailing={<Lock aria-hidden className="size-3.5" />}
            title="Read-only"
          />
        )}
      </Field>
      {canManage ? (
        <div>
          <Button type="submit" loading={pending} disabled={value.trim() === name}>
            Save changes
          </Button>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">Only owners and admins can edit the profile.</p>
      )}
    </form>
  );
}
