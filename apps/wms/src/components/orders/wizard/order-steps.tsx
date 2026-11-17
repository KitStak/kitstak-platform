'use client';

/** The six order wizard steps (shared by create = linear and edit = free). */
import * as React from 'react';
import { ClipboardList, MapPin, Package, Truck, FileText, CheckCircle2 } from 'lucide-react';
import type { WizardStep } from '@/components/ui/wizard';
import {
  customerStepSchema,
  detailsStepSchema,
  otherStepSchema,
  productsStepSchema,
  shippingStepSchema,
  type OrderFormValues,
} from './order-form-model';
import { StepConfirm } from './step-confirm';
import { StepCustomer } from './step-customer';
import { StepDetails } from './step-details';
import { StepOther } from './step-other';
import { StepProducts } from './step-products';
import { StepShipping } from './step-shipping';

export const ORDER_STEP_KEYS = ['details', 'customer', 'products', 'shipping', 'other', 'confirm'] as const;

/** First step that owns a server field error path (e.g. "shipZip" -> customer). */
export function stepOfField(path: string): string | null {
  const root = path.split('.')[0] ?? '';
  if (
    [
      'warehouseId',
      'clientId',
      'code',
      'orderTypeId',
      'orderType',
      'orderDate',
      'expectedShipDate',
      'note',
      'priority',
      'priorityRank',
      'storeOrderNumber',
    ].includes(root)
  )
    return 'details';
  if (
    root.startsWith('customer') ||
    root.startsWith('ship') ||
    [
      'companyName',
      'taxType',
      'taxId',
      'addressType',
      'billingAddress',
      'billing',
      'useShipAsBilling',
    ].includes(root)
  )
    return 'customer';
  if (root === 'lines') return 'products';
  if (
    root.startsWith('carrier') ||
    root.startsWith('return') ||
    root.startsWith('tracking') ||
    [
      'packingInstructions',
      'shipmentPackageId',
      'totalShippingCost',
      'reasonForExport',
      'rateShoppingPresetId',
    ].includes(root)
  )
    return 'shipping';
  return root ? 'other' : null;
}

export function buildOrderSteps(mode: 'create' | 'edit'): WizardStep<OrderFormValues>[] {
  return [
    {
      key: 'details',
      label: 'Order details',
      icon: ClipboardList,
      schema: detailsStepSchema,
      description: mode === 'create' ? undefined : 'Warehouse, client and order code are fixed after save.',
      render: () => <StepDetails />,
    },
    {
      key: 'customer',
      label: 'Customer & address',
      icon: MapPin,
      schema: customerStepSchema,
      render: () => <StepCustomer />,
    },
    {
      key: 'products',
      label: 'Products',
      icon: Package,
      schema: productsStepSchema,
      render: () => <StepProducts />,
    },
    {
      key: 'shipping',
      label: 'Shipping',
      icon: Truck,
      schema: shippingStepSchema,
      render: () => <StepShipping />,
      isOptional: true,
    },
    {
      key: 'other',
      label: 'Other info',
      icon: FileText,
      schema: otherStepSchema,
      render: () => <StepOther />,
      isOptional: true,
    },
    {
      key: 'confirm',
      label: 'Confirm',
      icon: CheckCircle2,
      render: (ctx) => <StepConfirm goTo={ctx.goTo} />,
    },
  ];
}
