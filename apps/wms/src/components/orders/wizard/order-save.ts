'use client';

/** Save helpers shared by create and edit: carrier name lookup and server error routing. */
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { isApiError } from '@/lib/api-client';
import { applyServerFieldErrors } from '@/lib/query-client';
import { toast } from '@/components/ui/toast';
import type { WizardController } from '@/components/ui/wizard';
import type { OrderFormOptions } from '../orders-client';
import type { CarrierLookup, OrderFormValues } from './order-form-model';
import { stepOfField } from './order-steps';

export function carrierLookup(options: OrderFormOptions | undefined): CarrierLookup {
  return {
    carrierCode: (id) => options?.carriers.find((c) => c.connectionId === id)?.carrierCode ?? null,
    serviceName: (id) =>
      id ? (options?.carriers.flatMap((c) => c.services).find((s) => s.id === id)?.name ?? null) : null,
  };
}

/** Toast + inline errors + jump to the step that owns the first failing field. */
export function reportSaveError(
  error: unknown,
  wizard: WizardController<OrderFormValues> | null,
  verb: 'create' | 'save',
): void {
  if (isApiError(error) && error.code === 'CONFLICT') {
    toast.error(
      'This record changed since you opened it',
      'Reload to see the latest version before saving again.',
      {
        action: { label: 'Reload', onClick: () => window.location.reload() },
        duration: Infinity,
      },
    );
    return;
  }
  if (isApiError(error) && error.code === 'DUPLICATE' && wizard) {
    wizard.form.setValue('codeTaken', true);
    wizard.goTo('details');
  }
  toast.error(
    verb === 'create' ? 'Could not create the order' : 'Could not save the order',
    isApiError(error) ? error.message : 'Something went wrong. Try again.',
  );
  if (wizard && isApiError(error)) {
    const first = Object.keys(error.fieldErrors)[0];
    const step = first ? stepOfField(first) : null;
    if (step) wizard.goTo(step);
    applyServerFieldErrors(wizard.form as unknown as UseFormReturn<FieldValues>, error);
  }
  if (isApiError(error) && error.code === 'DUPLICATE' && wizard) {
    const form = wizard.form;
    form.setError('code', {
      type: 'server',
      message: 'Code already taken. Click "auto generated" for the next free code.',
    });
    // After the step switch renders, put the caret on the offending field (not the first field of the step).
    setTimeout(() => form.setFocus('code'), 50);
  }
}
