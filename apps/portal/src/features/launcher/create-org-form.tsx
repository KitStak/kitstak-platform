'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { companyIssue } from '@/features/signup/fields';
import { createWorkspaceAction } from '@/server/signup-actions';

/**
 * Organization creation for a signed in person with no memberships yet (the launcher's empty
 * state). It runs the same server action as signup, so the new organization gets a signup intent
 * and the person goes on to pick their apps and start the free trial.
 */
export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const issue = companyIssue(name);
    setError(issue);
    if (issue) return;
    submitting.current = true;
    setPending(true);
    try {
      const result = await createWorkspaceAction({ company: name.trim(), handoff: {} });
      if (result.ok) {
        router.replace(result.next ?? '/signup/plan');
        router.refresh();
        return;
      }
      setError(result.error ?? 'We could not create the organization. Try again.');
    } catch {
      setError('We could not reach KitStak. Check your connection and try again.');
    }
    submitting.current = false;
    setPending(false);
  };

  return (
    <form noValidate onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <Field label="Company or team" error={error}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            size="lg"
            name="organization"
            autoComplete="organization"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Northwind Robotics"
            leadingIcon={<Building2 aria-hidden />}
            aria-describedby={describedBy}
            invalid={invalid}
            containerClassName="h-12 sm:h-11"
            className="text-md sm:text-base"
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="h-12 sm:h-11" loading={pending}>
        Create organization
      </Button>
    </form>
  );
}
