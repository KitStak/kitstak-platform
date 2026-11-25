/**
 * Server entry for /programs/new (docs/programs/SPEC.md 5.1, 5.4). Reads the URL (`?mode=`,
 * `?crmItem=`, `?template=`, `?copy=`, `?customer=`, `?name=`, `?draft=`), loads the prefill, the
 * draft to resume, the workspace calendar and everything the pickers need in one round trip, then
 * renders the wizard. Every sibling app read degrades to an empty list when the app is missing.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { projects } from '@/server/db/schema';
import { getDraft, getOrgCalendar, listDrafts, listProgramTemplates, listPrograms, wizardPrefill } from '@/server/domain/programs';
import { bridge } from '@/server/domain/programs/_program';
import { dealFactsFor, getCrmItems, searchCrmItems } from '@/server/integrations/crm';
import { getCustomers, registryOrgIds, searchCustomers } from '@/server/integrations/customers';
import { orgModuleFlags } from '@/server/entitlements';
import { integrationAvailability } from '@/server/integrations';
import { pageContext } from '@/server/page';
import { suggestProjectKey } from '@/lib/task-key';
import type { ProgramWizardPayload, WizardDraftDTO } from '@/lib/program-types';
import { NewProgramWizard } from './new-program-wizard';
import type { WizardData } from './wizard-types';
import type { StartMode } from './wizard-model';

const str = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const MODES: readonly StartMode[] = ['scratch', 'deal', 'template', 'copy', 'quick'];

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export async function NewProgramPage({ searchParams }: { readonly searchParams: Record<string, string | string[] | undefined> }) {
  const { ctx, context } = await pageContext('/programs/new');
  const mode = MODES.find((entry) => entry === str(searchParams.mode)) ?? null;
  const crmItem = str(searchParams.crmItem);
  const template = str(searchParams.template);
  const copy = str(searchParams.copy)?.toUpperCase();
  const customer = str(searchParams.customer);
  const name = str(searchParams.name);
  const draftId = str(searchParams.draft);
  const include = str(searchParams.include) ?? null;
  const [flags, availability] = await Promise.all([safe(orgModuleFlags(context.org.id), { crm: false, wms: false, projects: false, pulse: false }), safe(integrationAvailability(ctx), { crm: false, wms: false })]);
  const crmOn = Boolean(flags.crm && availability.crm);
  const pulseOn = Boolean(flags.pulse);

  const [calendar, drafts, templates, programs, keyRows, draft, prefill] = await Promise.all([
    getOrgCalendar(ctx),
    safe(listDrafts(ctx), [] as WizardDraftDTO[]),
    safe(listProgramTemplates(ctx), []),
    safe(listPrograms(ctx), []),
    db.select({ key: projects.key, name: projects.name, kind: projects.kind }).from(projects).where(and(eq(projects.orgId, ctx.orgId), isNull(projects.deletedAt))),
    draftId ? safe(getDraft(ctx, draftId), null) : Promise.resolve(null),
    crmItem || template || copy || customer ? safe(wizardPrefill(ctx, { crmItemId: crmItem, templateId: template, copyKey: copy, customerId: customer }), null as ProgramWizardPayload | null) : Promise.resolve(null),
  ]);

  // Pickers: customers and CRM accounts, won deals, kit items and Pulse jobs.
  const [customers, accounts, deals] = await Promise.all([
    safe(searchCustomers(ctx, '', 100), []),
    crmOn ? safe(searchCrmItems(ctx, { kinds: ['accounts'], limit: 50 }), []) : Promise.resolve([]),
    crmOn ? safe(searchCrmItems(ctx, { kinds: ['deals'], limit: 40 }), []) : Promise.resolve([]),
  ]);
  const dealFacts = await Promise.all(deals.map((deal) => safe(dealFactsFor(ctx, deal.id), null)));
  const programByDeal = new Map<string, string>();
  if (deals.length > 0) {
    const links = await safe(
      db.execute<{ deal_id: string; key: string }>(sql`
        select l.to_id as deal_id, p.key from core.record_links l join pm.projects p on p.id::text = l.from_id
        where l.org_id = ${ctx.orgId} and l.from_type = 'pm_program' and l.to_type = 'crm_deal' and p.deleted_at is null`),
      { rows: [] } as unknown as Awaited<ReturnType<typeof db.execute<{ deal_id: string; key: string }>>>,
    );
    for (const row of links.rows) programByDeal.set(row.deal_id, row.key);
  }
  const wonDeals = deals
    .map((deal, index) => ({ deal, facts: dealFacts[index] }))
    .filter((entry) => entry.facts?.won)
    .map(({ deal, facts }) => ({ id: deal.id, name: deal.name, accountName: facts!.accountName, valueCents: facts!.valueCents === null ? null : String(facts!.valueCents), currency: facts!.currency, closeDate: facts!.closeDate, programKey: programByDeal.get(deal.id) ?? null }))
    .sort((a, b) => (b.closeDate ?? '').localeCompare(a.closeDate ?? ''));

  const orgIds = await safe(registryOrgIds(ctx), [ctx.orgId]);
  const kitRows = await safe(
    db.execute<{ id: string; customer_id: string; sku: string; name: string }>(sql`
      select id::text, customer_id::text, sku, name from core.items
      where org_id = any(${sql.param(orgIds)}::uuid[]) and is_kit = true and deleted_at is null order by sku limit 1000`),
    { rows: [] } as unknown as Awaited<ReturnType<typeof db.execute<{ id: string; customer_id: string; sku: string; name: string }>>>,
  );

  let pulseJobs: WizardData['pulseJobs'] = null;
  if (pulseOn) {
    const { searchProgramJobs } = await import('@kitstak/pulse-bridge/programs');
    const found = await safe(searchProgramJobs(bridge(), { orgId: ctx.orgId, userId: ctx.userId }, { purpose: 'bills_to', target: { kind: 'program', programId: null } }), null);
    pulseJobs = found && found.available ? found.jobs.map((job) => ({ id: job.id, number: job.number, name: job.name, clientName: job.clientName, unitLabel: job.unitLabel, ongoing: job.kind === 'ongoing', perUnit: job.pricingModel === 'per_unit', refusal: job.refusal?.message ?? null })) : null;
  }

  // Names for the prefill's customer and the start record.
  let customerName: string | null = null;
  const prefillCustomer = prefill?.basics.customer ?? null;
  if (prefillCustomer?.kind === 'core') customerName = (await safe(getCustomers(ctx, [prefillCustomer.id]), new Map())).get(prefillCustomer.id)?.name ?? null;
  if (prefillCustomer?.kind === 'crm_account') customerName = (await safe(getCrmItems(ctx, [prefillCustomer.id]), new Map())).get(prefillCustomer.id)?.name ?? null;
  const crmItemTitle = crmItem ? (deals.find((deal) => deal.id === crmItem)?.name ?? (await safe(getCrmItems(ctx, [crmItem]), new Map())).get(crmItem)?.name ?? null) : null;
  const facts = crmItem ? (dealFacts[deals.findIndex((deal) => deal.id === crmItem)] ?? (await safe(dealFactsFor(ctx, crmItem), null))) : null;

  const taken = keyRows.map((row) => ({ key: row.key, name: row.name, kind: row.kind as 'project' | 'program' }));
  const takenSet = new Set(taken.map((row) => row.key));

  const data: WizardData = {
    today: prefill?.basics.startDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: calendar.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    calendar,
    drafts,
    draft,
    templates,
    programs: programs.map((program) => ({ key: program.key, name: program.name, color: program.color, icon: program.icon, customer: program.customer?.name ?? null, variantsCount: program.variantsCount, scheduleText: program.scheduleText })),
    taken,
    customers: [
      ...customers.map((entry) => ({ kind: 'core' as const, id: entry.id, name: entry.name })),
      ...accounts.map((entry) => ({ kind: 'crm_account' as const, id: entry.id, name: entry.name })),
    ],
    wonDeals,
    kitItems: kitRows.rows.map((row) => ({ id: row.id, customerId: row.customer_id, sku: row.sku, name: row.name })),
    pulseJobs,
    prefill,
    prefillExtra: { customerName, crmItemTitle, templateName: template ? (templates.find((entry) => entry.id === template)?.name ?? null) : null },
    deal: facts ? { name: facts.name, accountName: facts.accountName, valueCents: facts.valueCents === null ? null : String(facts.valueCents), currency: facts.currency, closeDate: facts.closeDate, termMonths: facts.rates.termMonths ?? null } : null,
    url: { mode, crmItem: crmItem ?? null, template: template ?? null, copy: copy ?? null, customer: customer ?? null, name: name ?? null, draft: draftId ?? null, include },
    suggestedKey: name ? suggestProjectKey(name, takenSet) : null,
    crmOn,
    pulseOn,
  };
  return <NewProgramWizard data={data} />;
}
