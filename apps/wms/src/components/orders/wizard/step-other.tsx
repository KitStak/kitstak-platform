'use client';

/** Step 5 — Other info: extra notes, client reference, fraud, packing warning, gift, retailer block, custom fields. */
import * as React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { FormGrid, FormGridFull, FormSection } from '@/components/ui/form';
import { CustomFieldsSection, type CustomFieldValues } from '@/components/shared/custom-fields-section';
import { AreaF, SelectF, TextF, YesNoF } from './fields';
import { NOTE_MAX, type OrderFormValues } from './order-form-model';
import { useOrderWizard } from './order-wizard-context';

const RETAILER_TIPS = {
  bol: 'Bill of lading number the retailer expects on the shipping documents.',
  pro: 'Carrier PRO (progressive) number for LTL freight.',
  po: "The retailer's purchase order number.",
  dept: 'Retailer department number printed on case labels.',
  markFor: 'Store or distribution center the cartons are marked for.',
  account: "Your account number in the retailer's vendor portal.",
} as const;

export function StepOther() {
  const { options, locks, canManageCustomFields } = useOrderWizard();
  const { control, setValue } = useFormContext<OrderFormValues>();
  const isGift = useWatch({ control, name: 'isGift' });
  const retailerId = useWatch({ control, name: 'retailerId' });
  const customFields = (useWatch({ control, name: 'customFields' }) ?? {}) as CustomFieldValues;
  const lock = Boolean(locks.header);

  return (
    <div className="flex flex-col gap-6">
      <FormSection title="Notes">
        <FormGrid columns={2}>
          <TextF name="extraNote1" label="Extra note" maxLength={NOTE_MAX} />
          <TextF name="extraNote2" label="Extra note 2" maxLength={NOTE_MAX} />
          <TextF name="extraNote3" label="Extra note 3" maxLength={NOTE_MAX} />
          <TextF name="extraNote4" label="Extra note 4" maxLength={NOTE_MAX} />
          <TextF name="extraNote5" label="Extra note 5" maxLength={NOTE_MAX} />
          <TextF name="clientReferenceCode" label="Client reference code" maxLength={100} disabled={lock} />
          <TextF
            name="fraud"
            label="Fraud"
            maxLength={NOTE_MAX}
            info="Fraud-check notes from the channel or your team."
          />
          <SelectF
            name="packingWarningTypeId"
            label="Packing warning type"
            options={(options?.packingWarningTypes ?? []).map((o) => ({ value: o.value, label: o.label }))}
            clearable
            disabled={lock || (options?.packingWarningTypes ?? []).length === 0}
            description={
              (options?.packingWarningTypes ?? []).length === 0
                ? 'Add packing warning types in Settings › Data setup'
                : undefined
            }
          />
          <TextF
            name="orderCodeGroupingRef"
            label="Order code grouping reference"
            readOnly
            disabled
            info="Set by order merging; read-only."
          />
        </FormGrid>
      </FormSection>

      <FormSection title="Gift">
        <FormGrid columns={2}>
          <YesNoF
            name="isGift"
            label="Gift"
            disabled={lock}
            onValue={(v) => !v && setValue('giftNote', '', { shouldDirty: true })}
          />
          <span aria-hidden />
          {isGift ? (
            <FormGridFull>
              <AreaF
                name="giftNote"
                label="Gift note"
                maxLength={NOTE_MAX}
                rows={2}
                placeholder="Printed on the packing slip"
              />
            </FormGridFull>
          ) : null}
        </FormGrid>
      </FormSection>

      <FormSection
        title="Retailer"
        description="For retail (B2B) orders that ship to a store or DC with routing requirements."
      >
        <FormGrid columns={3}>
          <SelectF
            name="retailerId"
            label="Retailer"
            options={(options?.retailers ?? []).map((r) => ({
              value: r.value,
              label: r.label,
              description: r.description ?? undefined,
            }))}
            clearable
            disabled={lock}
            info="Enables retailer case labels for this order."
          />
          <TextF
            name="bol"
            label="BOL"
            maxLength={100}
            disabled={lock || !retailerId}
            info={RETAILER_TIPS.bol}
          />
          <TextF
            name="pro"
            label="PRO"
            maxLength={100}
            disabled={lock || !retailerId}
            info={RETAILER_TIPS.pro}
          />
          <TextF
            name="retailerPo"
            label="PO"
            maxLength={100}
            disabled={lock || !retailerId}
            info={RETAILER_TIPS.po}
          />
          <TextF
            name="dept"
            label="Dept"
            maxLength={100}
            disabled={lock || !retailerId}
            info={RETAILER_TIPS.dept}
          />
          <TextF
            name="markFor"
            label="Mark for"
            maxLength={200}
            disabled={lock || !retailerId}
            info={RETAILER_TIPS.markFor}
          />
          <TextF
            name="retailerCustomerAccount"
            label="Retailer customer account number"
            maxLength={100}
            disabled={lock || !retailerId}
            info={RETAILER_TIPS.account}
          />
        </FormGrid>
      </FormSection>

      <FormSection title="Custom fields">
        <CustomFieldsSection
          entityType="shipment_order"
          values={customFields}
          canManage={canManageCustomFields}
          onChange={(next) => setValue('customFields', { ...next }, { shouldDirty: true })}
        />
      </FormSection>
    </div>
  );
}
