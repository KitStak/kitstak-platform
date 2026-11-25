/**
 * Other prices for this customer (docs/programs/SPEC.md 5.12, 6.1, 6.3): WMS billing fees for the
 * client and Pulse job prices, each with a mismatch flag against the card in force. Read only.
 */
import 'server-only';
import { versionFor } from '@kitstak/programs-engine/price';
import { listRecordLinks } from '@kitstak/db/record-links';
import { getJobFacts, getJobPriceRows } from '@kitstak/pulse-bridge/programs';
import { priceFor } from '@kitstak/programs-engine/price';
import { priceToScaled } from '@kitstak/programs-engine/money';
import { db } from '@/server/db';
import { clientBillingFees } from '@/server/integrations/wms-kits';
import type { DomainContext } from '../_shared';
import { bridge, shared, todayInZone } from './_program';
import { assertMoney, requireProgram } from './access';
import { versionsFor } from './pricing';

export async function otherPricesForCustomer(ctx: DomainContext, key: string) {
  const access = await requireProgram(ctx, key);
  assertMoney(access);
  const today = todayInZone(access.settings.timezone);
  const card = versionFor(await versionsFor(db, ctx, access.program.id), today);
  const cardPrice = card?.lines.find((l) => l.kind === 'per_unit' && l.variantId === null)?.unitPrice ?? null;
  const edges = await listRecordLinks(shared(db), ctx.orgId, { type: 'pm_program', id: access.program.id });
  const jobIds = edges.filter((e) => e.to.type === 'pulse_job').map((e) => e.to.id);
  const pulse = [];
  for (const jobId of jobIds) {
    const facts = await getJobFacts(bridge(db), { orgId: ctx.orgId, userId: ctx.userId }, jobId);
    if (!facts.available || !facts.job) continue;
    const price = priceFor(await getJobPriceRows(bridge(db), ctx.orgId, jobId), today)?.unitPrice ?? null;
    pulse.push({ jobId, number: facts.job.number, name: facts.job.name, unitPrice: price, mismatch: price !== null && cardPrice !== null && priceToScaled(price) !== priceToScaled(cardPrice) });
  }
  const wmsClient = edges.find((e) => e.to.type === 'wms_client' || e.from.type === 'wms_client');
  const wms = wmsClient ? await clientBillingFees(ctx, { wmsClientId: wmsClient.to.type === 'wms_client' ? wmsClient.to.id : wmsClient.from.id }) : { available: false as const, reason: 'not_linked' as const };
  return { cardUnitPrice: cardPrice, pulse, wms };
}
