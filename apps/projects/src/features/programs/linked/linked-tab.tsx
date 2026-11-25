'use client';
/**
 * Linked tab (docs/programs/SPEC.md 5.14): every record tied to the program, from the shared link
 * graph and the older link tables, grouped as Customer, CRM deals, Pulse jobs, Projects, Programs,
 * Builds, Kits and items, WMS and Other links. Each row opens the record, copies its link or
 * removes the link. "Link a record" and "Link Pulse job" add links.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Boxes, Briefcase, Building2, Copy, FolderKanban, Handshake, Link2, MoreHorizontal, Plus, Repeat2, Unlink, Warehouse } from 'lucide-react';
import { Badge, Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, IconButton, Skeleton, buttonVariants, toast } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { useProgramLinks } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import type { LinkedRecordDTO, LinkedRecordType } from '@/lib/program-types';
import { unlinkPulseJobAction, unlinkRecordAction } from '@/server/actions/program-links';
import { LinkedRecordChip, LinkedRecordMark } from '@/features/integrations/record-chip';
import { RecordLinkDialog } from '@/features/integrations/record-link-dialog';
import { LinkPulseJobDialog } from '@/features/integrations/link-pulse-job-dialog';
import { liveProgramUrl } from '../kit/live-pages';
import { useCurrentProgram } from '../program-context';

type SectionId = 'customer' | 'deals' | 'pulse' | 'projects' | 'programs' | 'builds' | 'kits' | 'wms' | 'other';

const SECTIONS: readonly { readonly id: SectionId; readonly title: string; readonly icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; readonly types: readonly LinkedRecordType[]; readonly empty: string }[] = [
  { id: 'customer', title: 'Customer', icon: Building2, types: ['core_customer', 'crm_account'], empty: 'No customer or CRM account linked.' },
  { id: 'deals', title: 'CRM deals', icon: Handshake, types: ['crm_deal'], empty: 'No CRM deals linked.' },
  { id: 'pulse', title: 'Pulse jobs', icon: Briefcase, types: ['pulse_job'], empty: 'No Pulse jobs linked.' },
  { id: 'projects', title: 'Projects', icon: FolderKanban, types: ['pm_project'], empty: 'No projects linked.' },
  { id: 'programs', title: 'Programs', icon: Repeat2, types: ['pm_program'], empty: 'No other programs linked.' },
  { id: 'builds', title: 'Builds', icon: Boxes, types: ['pm_build', 'pm_task'], empty: 'No builds linked.' },
  { id: 'kits', title: 'Kits and items', icon: Boxes, types: ['core_item', 'wms_product', 'pm_variant'], empty: 'No kits linked to variants.' },
  { id: 'wms', title: 'WMS', icon: Warehouse, types: ['wms_shipment_order', 'wms_client', 'wms_work_order'], empty: 'No WMS records linked.' },
];

const TYPE_LABEL: Readonly<Record<LinkedRecordType, string>> = {
  core_customer: 'Customer',
  core_item: 'Item',
  crm_deal: 'CRM deal',
  crm_account: 'CRM account',
  pm_project: 'Project',
  pm_program: 'Program',
  pm_task: 'Task',
  pm_build: 'Build',
  pm_variant: 'Variant',
  pulse_job: 'Pulse job',
  wms_work_order: 'WMS work order',
  wms_shipment_order: 'WMS shipment order',
  wms_client: 'WMS client',
  wms_product: 'WMS product',
};

function sectionOf(type: LinkedRecordType): SectionId {
  return SECTIONS.find((section) => section.types.includes(type))?.id ?? 'other';
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return typeof window === 'undefined' ? url : `${window.location.origin}${url}`;
}

/** Cached statuses come in lowercase from some apps ("active"); show them as labels ("Active"). */
function withStatusLabel(link: LinkedRecordDTO): LinkedRecordDTO {
  const status = link.status;
  if (!status || status !== status.toLowerCase()) return link;
  const label = status.replace(/_/g, ' ');
  return { ...link, status: `${label.charAt(0).toUpperCase()}${label.slice(1)}` };
}

function LinkRow({ link, canEdit, onRemove }: { readonly link: LinkedRecordDTO; readonly canEdit: boolean; readonly onRemove: (link: LinkedRecordDTO) => void }) {
  const url = liveProgramUrl(link.url);
  const external = Boolean(url && /^https?:\/\//.test(url));
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-testid="linked-row" data-type={link.type}>
      <span className="min-w-0 flex-1">
        <LinkedRecordChip record={withStatusLabel(link)} />
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">
        {link.source !== 'record_links' ? <Badge tone="outline" size="sm">Older link</Badge> : null}
        {link.direction === 'in' ? <span className="max-sm:hidden">Links here</span> : null}
        <span className="max-sm:hidden">{TYPE_LABEL[link.type]}</span>
      </span>
      {url && !link.dangling ? (
        <a href={url} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Open
          {external ? <ArrowUpRight aria-hidden /> : null}
        </a>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${link.dangling ? 'this link' : link.title}`} icon={<MoreHorizontal aria-hidden />} size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {url && !link.dangling ? (
            <DropdownMenuItem icon={<ArrowUpRight aria-hidden />} onSelect={() => (external ? window.open(url, '_blank', 'noopener,noreferrer') : window.location.assign(url))}>
              Open
            </DropdownMenuItem>
          ) : null}
          {url ? (
            <DropdownMenuItem
              icon={<Copy aria-hidden />}
              onSelect={() => {
                void navigator.clipboard
                  .writeText(absoluteUrl(url))
                  .then(() => toast.success('Link copied.'))
                  .catch(() => toast.error("Couldn't copy the link", 'Your browser blocked the clipboard.'));
              }}
            >
              Copy link
            </DropdownMenuItem>
          ) : null}
          {canEdit && link.removable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" icon={<Unlink aria-hidden />} description={link.moneyEdge ? 'Revenue stops going to this job.' : undefined} onSelect={() => onRemove(link)}>
                Remove link
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function LinkedTab({ initialLinks }: { readonly initialLinks: readonly LinkedRecordDTO[] }) {
  const { key, program, capabilities, variants } = useCurrentProgram();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const links = useProgramLinks(key, { initialData: [...initialLinks] });
  const [adding, setAdding] = useState(false);
  const [linkingJob, setLinkingJob] = useState(() => params?.get('link') === 'pulse' && capabilities.canManage);
  const [removing, setRemoving] = useState<LinkedRecordDTO | null>(null);
  const canEdit = capabilities.canEdit;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
  };
  const unlink = useServerAction(unlinkRecordAction, {
    successMessage: 'Link removed.',
    errorTitle: "Couldn't remove the link",
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
  });
  const unlinkJob = useServerAction(unlinkPulseJobAction, {
    successMessage: 'Pulse job unlinked. New revenue counts in the program.',
    errorTitle: "Couldn't unlink the job",
    onSuccess: async () => {
      setRemoving(null);
      await refresh();
    },
  });
  const items = useMemo(() => links.data ?? [], [links.data]);
  const kitRows = useMemo(
    () =>
      variants
        .filter((variant) => variant.coreItem || variant.wmsProduct)
        .map((variant) => ({ variant, kit: (variant.coreItem ?? variant.wmsProduct) as { readonly sku: string | null; readonly name: string } })),
    [variants],
  );
  const grouped = useMemo(() => {
    const map = new Map<SectionId, LinkedRecordDTO[]>();
    for (const link of items) {
      const id = sectionOf(link.type);
      map.set(id, [...(map.get(id) ?? []), link]);
    }
    for (const list of map.values()) list.sort((a, b) => Number(b.moneyEdge) - Number(a.moneyEdge) || a.title.localeCompare(b.title));
    return map;
  }, [items]);
  const billsTo = items.find((link) => link.type === 'pulse_job' && link.relation === 'bills_to');
  const hasPulse = program.setup.hasPulseJob !== null;
  const other = grouped.get('other') ?? [];
  const sections = SECTIONS.filter((section) => (grouped.get(section.id)?.length ?? 0) > 0 || (section.id === 'kits' && kitRows.length > 0) || section.id === 'customer' || (section.id === 'pulse' && hasPulse));
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5" data-testid="linked-tab">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold text-fg">
          Linked
          <span className="text-sm font-normal text-fg-muted tabular-nums">{items.length}</span>
        </h2>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {capabilities.canManage && hasPulse && !billsTo ? (
            <Button variant="secondary" onClick={() => setLinkingJob(true)}>
              <Briefcase aria-hidden />
              Link Pulse job
            </Button>
          ) : null}
          {canEdit ? (
            <Button onClick={() => setAdding(true)} data-testid="link-record">
              <Link2 aria-hidden />
              Link a record
            </Button>
          ) : null}
        </span>
      </header>
      {links.isLoading ? (
        <Skeleton height={200} rounded="lg" />
      ) : items.length === 0 && kitRows.length === 0 ? (
        <EmptyState
          visual={<Link2 aria-hidden className="size-10 text-icon" />}
          title="Nothing linked yet"
          description="Link the customer, the CRM deal it came from, a Pulse job for labor and margin, related projects or WMS orders. Every app shows the same link."
          actions={canEdit ? <Button onClick={() => setAdding(true)}>Link a record</Button> : null}
        />
      ) : (
        <>
          {sections.map((section) => {
            const rows = grouped.get(section.id) ?? [];
            const Icon = section.icon;
            return (
              <section key={section.id} className="rounded-xl border border-border-subtle bg-panel shadow-xs" aria-labelledby={`linked-${section.id}`} data-testid={`linked-section-${section.id}`}>
                <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
                  <Icon aria-hidden className="size-4 text-icon" />
                  <h3 id={`linked-${section.id}`} className="text-sm font-semibold text-fg">
                    {section.title}
                  </h3>
                  <span className="text-xs text-fg-muted tabular-nums">{section.id === 'kits' ? rows.length + kitRows.length : rows.length}</span>
                  {section.id === 'pulse' && billsTo ? <span className="ml-auto text-xs text-fg-muted">Revenue goes to {billsTo.title.split(' ')[0]}</span> : null}
                </header>
                <ul className="flex flex-col divide-y divide-border-subtle">
                  {rows.map((link) => (
                    <LinkRow key={link.linkId} link={link} canEdit={canEdit && (!link.moneyEdge || capabilities.canManage)} onRemove={setRemoving} />
                  ))}
                  {section.id === 'kits'
                    ? kitRows.map(({ variant, kit }) => (
                        <li key={`kit:${variant.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                          <LinkedRecordMark record={{ type: variant.coreItem ? 'core_item' : 'wms_product', app: variant.coreItem ? 'core' : 'wms' }} />
                          <span className="font-key text-xs text-fg-secondary">{kit.sku ?? ''}</span>
                          <span className="min-w-0 flex-1 truncate text-fg">{kit.name}</span>
                          <Badge tone="neutral" size="sm">{`Uses kit · ${variant.name}`}</Badge>
                        </li>
                      ))
                    : null}
                  {rows.length === 0 && !(section.id === 'kits' && kitRows.length) ? (
                    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-fg-muted">
                      {section.empty}
                      {section.id === 'pulse' && capabilities.canManage ? (
                        <Button size="sm" variant="ghost" onClick={() => setLinkingJob(true)}>
                          <Plus aria-hidden />
                          Link Pulse job
                        </Button>
                      ) : canEdit ? (
                        <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                          <Plus aria-hidden />
                          Link
                        </Button>
                      ) : null}
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
          {other.length ? (
            <section className="rounded-xl border border-border-subtle bg-panel shadow-xs" aria-label="Other links">
              <header className="border-b border-border-subtle px-4 py-2.5 text-sm font-semibold text-fg">Other links</header>
              <ul className="flex flex-col divide-y divide-border-subtle">
                {other.map((link) => (
                  <LinkRow key={link.linkId} link={link} canEdit={canEdit} onRemove={setRemoving} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      {adding ? <RecordLinkDialog open={adding} onOpenChange={setAdding} from={{ type: 'pm_program', id: program.id }} existing={items} onLinked={() => void refresh()} /> : null}
      {linkingJob ? <LinkPulseJobDialog open={linkingJob} onOpenChange={setLinkingJob} target={{ kind: 'program', programKey: key, programId: program.id }} onLinked={() => void refresh()} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
        title={removing?.moneyEdge ? `Stop billing ${removing.title}?` : 'Remove this link?'}
        description={removing?.moneyEdge ? 'Revenue on open days goes to the program instead. Closed days do not change.' : 'Only the link is removed. Both records stay.'}
        confirmLabel={removing?.moneyEdge ? 'Unlink job' : 'Remove link'}
        destructive
        loading={unlink.pending || unlinkJob.pending}
        onConfirm={() => {
          if (!removing) return;
          if (removing.moneyEdge && removing.type === 'pulse_job') void unlinkJob.run({ programKey: key });
          else void unlink.run({ linkId: removing.linkId });
        }}
      />
    </div>
  );
}
