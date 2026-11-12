'use client';

import * as React from 'react';
import { useWatch } from 'react-hook-form';
import { Check, Circle } from 'lucide-react';
import { Form, FormField, SubmitBar, useZodForm } from '@/components/ui/form';
import { TextField } from '@/components/ui/text-field';
import { useApiMutation } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { passwordChecks, type PasswordPolicyHints } from '../password-checks';
import { changePasswordSchema, type ChangePasswordValues } from './account-options';

const EMPTY: ChangePasswordValues = { currentPassword: '', newPassword: '', confirmPassword: '' };
const RULES_ID = 'new-password-rules';

function PolicyChecklist({
  password,
  policy,
}: {
  readonly password: string;
  readonly policy: PasswordPolicyHints;
}) {
  return (
    <ul
      id={RULES_ID}
      aria-label="Password requirements"
      className="mt-1.5 grid grid-cols-1 gap-0.5 sm:grid-cols-2"
    >
      {passwordChecks(password, policy).map((check) => (
        <li
          key={check.key}
          className={cn('flex items-center gap-1 text-2xs', check.ok ? 'text-success' : 'text-faint')}
        >
          {check.ok ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Circle className="h-2.5 w-2.5" aria-hidden />
          )}
          {check.label}
          <span className="sr-only">{check.ok ? '(met)' : '(not met)'}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Current / new / confirm with the live policy checklist. POST /api/auth/change-password
 * signs out every other device and re-issues the session for this browser.
 */
export function ChangePasswordForm({ policy }: { readonly policy: PasswordPolicyHints }) {
  const schema = React.useMemo(() => changePasswordSchema(policy), [policy]);
  const form = useZodForm(schema, EMPTY);
  const newPassword = useWatch({ control: form.control, name: 'newPassword' }) ?? '';
  const mutation = useApiMutation<ChangePasswordValues, unknown, ChangePasswordValues>({
    path: '/api/auth/change-password',
    method: 'POST',
    form,
    successTitle: 'Password changed',
    successMessage: 'Other devices were signed out. This browser stays signed in.',
    onSuccess: () => form.reset(EMPTY),
  });

  return (
    <Form form={form} onSubmit={(values) => mutation.mutateAsync(values)} className="space-y-4" guardUnsaved>
      <FormField<ChangePasswordValues> name="currentPassword" label="Current password" required>
        {(c) => <TextField {...c} type="password" autoComplete="current-password" value={c.value ?? ''} />}
      </FormField>
      <div>
        <FormField<ChangePasswordValues> name="newPassword" label="New password" required>
          {(c) => (
            <TextField
              {...c}
              type="password"
              autoComplete="new-password"
              value={c.value ?? ''}
              aria-describedby={cn(c['aria-describedby'], RULES_ID)}
            />
          )}
        </FormField>
        <PolicyChecklist password={newPassword} policy={policy} />
      </div>
      <FormField<ChangePasswordValues> name="confirmPassword" label="Confirm new password" required>
        {(c) => <TextField {...c} type="password" autoComplete="new-password" value={c.value ?? ''} />}
      </FormField>
      <SubmitBar
        submitLabel="Change password"
        cancelLabel="Clear"
        onCancel={() => form.reset(EMPTY)}
        pending={mutation.isPending}
      />
    </Form>
  );
}
