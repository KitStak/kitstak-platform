/**
 * Shipment-order status pill, drawn with the shared Pill through `TonePill`: Open and every
 * in-process step info, done positive, Shortage caution, On hold neutral, Cancelled critical.
 * Same tones as `<StatusPill domain="shipmentOrder">`.
 */
import * as React from 'react';
import { TonePill } from '@/components/ui/status-pill';
import { isPartialStatus, statusLabel, TONES, type StatusTone } from '@/lib/status-colors';

export type OrderTone = StatusTone;

const OPEN: OrderTone = TONES.teal;
const IN_PROCESS: OrderTone = TONES.blue;
const DONE: OrderTone = TONES.green;
const SHORT: OrderTone = TONES.shortage;
const HOLD: OrderTone = TONES.hold;
const CANCELLED: OrderTone = TONES.red;
const UNKNOWN: OrderTone = TONES.grey;

const ORDER_TONES: Readonly<Record<string, OrderTone>> = {
  open: OPEN,
  'ready to pick': IN_PROCESS,
  'picking started': IN_PROCESS,
  picked: IN_PROCESS,
  'ready to pack': IN_PROCESS,
  'packing started': IN_PROCESS,
  'ready to sort': IN_PROCESS,
  'sorting started': IN_PROCESS,
  'ready to load': IN_PROCESS,
  'loading started': IN_PROCESS,
  'ready to ship': TONES.purple,
  shipped: DONE,
  'partially shipped': DONE,
  delivered: DONE,
  shortage: SHORT,
  'on hold': HOLD,
  cancelled: CANCELLED,
};

export function orderStatusTone(status: string | null | undefined): OrderTone {
  return ORDER_TONES[(status ?? '').trim().toLowerCase()] ?? UNKNOWN;
}

export function OrderStatusPill({
  status,
  className,
}: {
  readonly status: string;
  /** @deprecated Pills have one size; kept so existing call sites compile. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  return (
    <TonePill
      status={status}
      tone={orderStatusTone(status)}
      partial={isPartialStatus(status)}
      className={className}
    >
      {statusLabel(status)}
    </TonePill>
  );
}
