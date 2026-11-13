'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { organization } from '@/lib/auth-client';
import { slugWithSuffix, slugify } from '@/lib/slug';

const NAME_MIN = 2;
const NAME_MAX = 80;

/** Empty-state org creation (signed-in user with no memberships yet). */
export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      setError(`Use ${NAME_MIN} to ${NAME_MAX} characters.`);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const base = slugify(trimmed);
      let result = await organization.create({ name: trimmed, slug: base });
      if (result.error) {
        result = await organization.create({ name: trimmed, slug: slugWithSuffix(base) });
      }
      if (result.error) {
        setError(result.error.message ?? 'We couldn’t create the organization. Try again.');
        setPending(false);
        return;
      }
      if (result.data) await organization.setActive({ organizationId: result.data.id });
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field label="Organization name" error={error}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            size="lg"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Acme Inc."
            leadingIcon={<Building2 aria-hidden />}
            aria-describedby={describedBy}
            invalid={invalid}
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={pending}>
        Create organization
      </Button>
    </form>
  );
}
