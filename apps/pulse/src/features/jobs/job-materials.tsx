'use client';
/**
 * Materials: who buys the parts, how material is costed (a cost per unit, or the parts really
 * used), the usage rows with scrap, and the other costs of the job (freight, pallets, outside
 * help). Every row can be added, edited and deleted with undo.
 */
import { useMemo, useState } from 'react';
import { Boxes, Lock, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import {
  Button,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  ToggleGroup,
  toast,
} from '@/components/ui';
import { KpiTile } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { COST_CATEGORY_LABELS } from '@/lib/constants';
import { formatMoney, formatNumber, formatPercentBp, formatUnitPrice } from '@/lib/format';
import { scrapUnitsBp } from '@/lib/profit';
import { shortDate } from '@/lib/profit/calendar';
import type { CostEntryDTO, JobPriceDTO, MaterialUsageDTO } from '@/lib/types';
import {
  deleteCostAction,
  deleteMaterialUsageAction,
  restoreCostAction,
  restoreMaterialUsageAction,
} from '@/server/actions/entries';
import { updateJobAction } from '@/server/actions/jobs';
import { CostDialog, UsageDialog } from './forms/entry-forms';
import { PriceDialog } from './forms/job-dialogs';
import { useDeleteWithUndo, useJobCosts, useJobUsage, useRefreshJob } from './job-data';
import { singularUnit } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain, LoadError } from './job-ui';
import { callAction } from './use-job-actions';

function useHidden() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  return {
    hidden,
    hide: (id: string) => setHidden((current) => new Set(current).add(id)),
    show: (id: string) =>
      setHidden((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
  };
}

export function JobMaterials({ job, today }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const removeWithUndo = useDeleteWithUndo(refresh);
  const seesMoney = shell.seesMoney && !job.stats.moneyHidden;
  const canManage = shell.can('job:manage');
  const canLogMaterial = shell.can('material:log');
  const canCost = shell.can('cost:manage');
  const unit = singularUnit(job.unitLabel);
  const usage = useJobUsage(job.id);
  const costs = useJobCosts(job.id, seesMoney);
  const usageHidden = useHidden();
  const costHidden = useHidden();
  const [usageDialog, setUsageDialog] = useState<MaterialUsageDTO | 'new' | null>(null);
  const [costDialog, setCostDialog] = useState<CostEntryDTO | 'new' | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const usageRows = useMemo(
    () => (usage.data ?? []).filter((row) => row.deletedAt === null && !usageHidden.hidden.has(row.id)),
    [usage.data, usageHidden.hidden],
  );
  const costRows = useMemo(
    () => (costs.data ?? []).filter((row) => row.deletedAt === null && !costHidden.hidden.has(row.id)),
    [costs.data, costHidden.hidden],
  );
  const partsOwner = job.partsOwner ?? 'us';
  const scrapBp = scrapUnitsBp(job.stats.unitsGood, job.stats.unitsScrap);
  const materialPrices = job.prices.filter(
    (price: JobPriceDTO, index, all) =>
      index === all.length - 1 || price.materialCostPerUnit !== all[index + 1]?.materialCostPerUnit,
  );

  const change = async (
    patch: { partsOwner?: 'us' | 'client'; materialMethod?: 'standard' | 'actual' },
    message: string,
  ) => {
    setSaving(true);
    const saved = await callAction(updateJobAction({ jobId: job.id, version: job.version, patch }));
    setSaving(false);
    if (!saved) return;
    await refresh();
    toast.success(message, 'Entries in open months were worked out again.');
  };

  return (
    <div className="flex flex-col gap-5" data-testid="job-materials">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {seesMoney ? (
          <KpiTile
            label="Material cost so far"
            value={
              partsOwner === 'client' && (job.stats.materialCents ?? 0) === 0
                ? 'Client supplies'
                : formatMoney(job.stats.materialCents, { cents: false })
            }
            footer={
              <span className="text-xs text-fg-muted">
                {formatMoney(job.stats.scrapCents, { cents: false })} of that is scrap
              </span>
            }
            explain={
              <Explain
                title="Material cost so far"
                rule={
                  job.materialMethod === 'standard'
                    ? 'Good and scrapped units times the material cost for one, for parts you buy. Parts the client supplies cost nothing.'
                    : 'The parts really used and scrapped, each at its own cost, for parts you buy. Parts the client supplies cost nothing.'
                }
                rows={[
                  { label: 'Material cost', value: formatMoney(job.stats.materialCents) },
                  { label: 'of that, scrap', value: formatMoney(job.stats.scrapCents), kind: 'note' },
                ]}
              />
            }
          />
        ) : null}
        <KpiTile
          label="Scrapped"
          value={formatNumber(job.stats.unitsScrap, { maxDigits: 0 })}
          footer={
            <span className="text-xs text-fg-muted">
              {scrapBp === null ? 'no units yet' : `${formatPercentBp(scrapBp)} of what was made`}
            </span>
          }
        />
        {seesMoney ? (
          <KpiTile
            label="Other costs so far"
            value={formatMoney(job.stats.otherCents, { cents: false })}
            footer={
              <span className="text-xs text-fg-muted">
                {costRows.length} {costRows.length === 1 ? 'row' : 'rows'}
              </span>
            }
          />
        ) : null}
        <KpiTile
          label="Usage rows"
          value={formatNumber(usageRows.length)}
          footer={
            <span className="text-xs text-fg-muted">
              {job.materialMethod === 'actual' ? 'these set the material cost' : 'for your records'}
            </span>
          }
        />
      </div>

      <Panel title="How material is costed">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-fg-secondary">Who buys the parts?</p>
            <ToggleGroup
              label="Who buys the parts?"
              value={partsOwner}
              onValueChange={(value) =>
                canManage && !saving && value !== partsOwner
                  ? void change(
                      { partsOwner: value },
                      value === 'client' ? 'The client now supplies the parts' : 'You now buy the parts',
                    )
                  : undefined
              }
              options={[
                { value: 'us', label: 'We do', disabled: !canManage },
                { value: 'client', label: 'The client does', disabled: !canManage },
              ]}
            />
            <p className="text-sm text-fg-secondary">
              {partsOwner === 'client'
                ? 'Parts the client supplies cost you nothing. Pulse still tracks how many were used and scrapped.'
                : 'Parts you buy are a cost of the job, scrap included.'}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-fg-secondary">How should Pulse cost them?</p>
            <ToggleGroup
              label="How should Pulse cost material?"
              value={job.materialMethod}
              onValueChange={(value) =>
                canManage && !saving && value !== job.materialMethod
                  ? void change(
                      { materialMethod: value },
                      value === 'actual'
                        ? 'Material now follows the usage rows'
                        : 'Material now follows the cost per unit',
                    )
                  : undefined
              }
              options={[
                { value: 'standard', label: 'A cost for each unit', disabled: !canManage },
                { value: 'actual', label: 'The parts really used', disabled: !canManage },
              ]}
            />
            <p className="text-sm text-fg-secondary">
              {job.materialMethod === 'standard'
                ? `Simple: every ${unit} made costs the same amount of material. Good for steady kits.`
                : 'Exact: material cost is the usage rows below. Good when parts and scrap vary a lot.'}
            </p>
          </div>
        </div>
        {job.materialMethod === 'standard' && partsOwner === 'us' ? (
          <div className="mt-5 flex flex-col gap-3 border-t border-border-subtle pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg">
                Material cost for one {unit}:{' '}
                <span className="font-semibold tabular-nums">
                  {seesMoney ? formatUnitPrice(job.materialCostPerUnit, { empty: 'Not set' }) : 'Hidden'}
                </span>
              </p>
              {shell.can('revenue:manage') ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Pencil aria-hidden />}
                  onClick={() => setPriceOpen(true)}
                  data-testid="material-change"
                >
                  Change it from a day
                </Button>
              ) : null}
            </div>
            {seesMoney && materialPrices.length > 1 ? (
              <ul className="flex flex-col gap-1 text-sm text-fg-secondary">
                {materialPrices.map((price) => (
                  <li key={price.id} className="flex justify-between gap-3 tabular-nums">
                    <span>
                      {price.effectiveFrom === '0001-01-01'
                        ? 'From the start'
                        : `From ${shortDate(price.effectiveFrom)}`}
                    </span>
                    <span className="text-fg">
                      {formatUnitPrice(price.materialCostPerUnit, { empty: 'Not set' })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Material used"
        action={
          canLogMaterial ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => setUsageDialog('new')}
              data-testid="usage-add"
            >
              Add usage
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {usage.isError ? (
          <div className="p-4">
            <LoadError what="the usage rows" onRetry={() => void usage.refetch()} />
          </div>
        ) : usage.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true">
            <span className="sr-only">Loading material used</span>
            <Skeleton height={28} />
            <Skeleton height={28} />
          </div>
        ) : usageRows.length === 0 ? (
          <Teach
            testId="usage-empty"
            size="sm"
            icon={Boxes}
            title="No material usage logged"
            why={
              job.materialMethod === 'actual'
                ? 'This job costs material from the parts really used, so add a row for each part. Until then material cost is zero.'
                : 'This job uses a cost per unit, so usage rows are optional. Add them when you want to see scrap and planned against used for each part.'
            }
            actions={
              canLogMaterial ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setUsageDialog('new')}>
                  Add usage
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Material used" data-testid="usage-table">
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell>Part</TableHeaderCell>
                  <TableHeaderCell>Day</TableHeaderCell>
                  <TableHeaderCell numeric>Planned</TableHeaderCell>
                  <TableHeaderCell numeric>Used</TableHeaderCell>
                  <TableHeaderCell numeric>Scrapped</TableHeaderCell>
                  {seesMoney ? <TableHeaderCell numeric>Cost for one</TableHeaderCell> : null}
                  {seesMoney ? <TableHeaderCell numeric>Cost</TableHeaderCell> : null}
                  <TableHeaderCell>Bought by</TableHeaderCell>
                  <TableHeaderCell className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {usageRows.map((row) => (
                  <TableRow key={row.id} data-testid="usage-row">
                    <TableCell>
                      <span className="font-medium">{row.itemName ?? row.itemSku ?? 'Part'}</span>
                      {row.itemSku && row.itemName ? (
                        <span className="block text-xs text-fg-muted">{row.itemSku}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-secondary">
                      {shortDate(row.usageDate)}
                    </TableCell>
                    <TableCell numeric>{formatNumber(row.quantityPlanned, { empty: '' })}</TableCell>
                    <TableCell numeric>{formatNumber(row.quantityUsed)}</TableCell>
                    <TableCell numeric>
                      {Number(row.quantityScrapped) > 0 ? formatNumber(row.quantityScrapped) : ''}
                    </TableCell>
                    {seesMoney ? (
                      <TableCell numeric>{formatUnitPrice(row.unitCost, { empty: '' })}</TableCell>
                    ) : null}
                    {seesMoney ? (
                      <TableCell numeric>
                        {row.resolvedSuppliedBy === 'client' ? (
                          <span className="text-fg-muted">No cost</span>
                        ) : (
                          formatMoney(row.costCents, { empty: '' })
                        )}
                        {(row.scrapCents ?? 0) > 0 ? (
                          <span className="block text-2xs text-fg-muted">
                            {formatMoney(row.scrapCents)} scrap
                          </span>
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-fg-secondary">
                      {row.resolvedSuppliedBy === 'client' ? 'Client' : 'Us'}
                    </TableCell>
                    <TableCell className="pl-0 text-right whitespace-nowrap">
                      {row.locked ? (
                        <Lock aria-label="This month is closed" className="inline size-3.5 text-fg-muted" />
                      ) : canLogMaterial ? (
                        <>
                          <IconButton
                            label={`Edit ${row.itemName ?? 'this usage'}`}
                            icon={<Pencil aria-hidden />}
                            size="sm"
                            onClick={() => setUsageDialog(row)}
                          />
                          <IconButton
                            label={`Delete ${row.itemName ?? 'this usage'}`}
                            icon={<Trash2 aria-hidden />}
                            size="sm"
                            data-testid="usage-delete"
                            onClick={() =>
                              void removeWithUndo({
                                label: row.itemName ?? row.itemSku ?? 'the usage row',
                                hide: () => usageHidden.hide(row.id),
                                show: () => usageHidden.show(row.id),
                                remove: () => deleteMaterialUsageAction({ id: row.id }),
                                restore: () => restoreMaterialUsageAction({ id: row.id }),
                              })
                            }
                          />
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {seesMoney ? (
        <Panel
          title="Other costs on this job"
          action={
            canCost ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Plus aria-hidden />}
                onClick={() => setCostDialog('new')}
                data-testid="cost-add"
              >
                Add a cost
              </Button>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          {costs.isError ? (
            <div className="p-4">
              <LoadError what="the other costs" onRetry={() => void costs.refetch()} />
            </div>
          ) : costs.isPending ? (
            <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true">
              <span className="sr-only">Loading other costs</span>
              <Skeleton height={28} />
            </div>
          ) : costRows.length === 0 ? (
            <Teach
              testId="costs-empty"
              size="sm"
              icon={Receipt}
              title="No other costs yet"
              why="Freight, pallets, a rented machine, outside help: anything this job cost that is not labor or parts. Leave them out and the job looks more profitable than it is."
              actions={
                canCost ? (
                  <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCostDialog('new')}>
                    Add a cost
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Other costs" data-testid="costs-table">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Day</TableHeaderCell>
                    <TableHeaderCell>Kind</TableHeaderCell>
                    <TableHeaderCell>Paid to</TableHeaderCell>
                    <TableHeaderCell>Note</TableHeaderCell>
                    <TableHeaderCell numeric>Amount</TableHeaderCell>
                    <TableHeaderCell className="w-20">
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {costRows.map((row) => (
                    <TableRow key={row.id} data-testid="cost-row">
                      <TableCell className="whitespace-nowrap">{shortDate(row.costDate)}</TableCell>
                      <TableCell>{COST_CATEGORY_LABELS[row.category]}</TableCell>
                      <TableCell className="text-fg-secondary">
                        {row.vendor ?? ''}
                        {row.reference ? (
                          <span className="block text-xs text-fg-muted">{row.reference}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-fg-secondary">
                        {row.note ?? ''}
                      </TableCell>
                      <TableCell numeric className="font-medium">
                        {formatMoney(row.amountCents)}
                      </TableCell>
                      <TableCell className="pl-0 text-right whitespace-nowrap">
                        {row.locked ? (
                          <Lock aria-label="This month is closed" className="inline size-3.5 text-fg-muted" />
                        ) : canCost ? (
                          <>
                            <IconButton
                              label={`Edit the ${COST_CATEGORY_LABELS[row.category].toLowerCase()} cost of ${shortDate(row.costDate)}`}
                              icon={<Pencil aria-hidden />}
                              size="sm"
                              onClick={() => setCostDialog(row)}
                              data-testid="cost-edit"
                            />
                            <IconButton
                              label={`Delete the ${COST_CATEGORY_LABELS[row.category].toLowerCase()} cost of ${shortDate(row.costDate)}`}
                              icon={<Trash2 aria-hidden />}
                              size="sm"
                              data-testid="cost-delete"
                              onClick={() =>
                                void removeWithUndo({
                                  label: `the ${COST_CATEGORY_LABELS[row.category].toLowerCase()} cost`,
                                  hide: () => costHidden.hide(row.id),
                                  show: () => costHidden.show(row.id),
                                  remove: () => deleteCostAction({ id: row.id }),
                                  restore: () => restoreCostAction({ id: row.id }),
                                })
                              }
                            />
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
      ) : null}

      {usageDialog ? (
        <UsageDialog
          key={usageDialog === 'new' ? 'new' : usageDialog.id}
          job={job}
          row={usageDialog === 'new' ? null : usageDialog}
          today={today}
          open
          onOpenChange={(open) => (open ? undefined : setUsageDialog(null))}
          onSaved={refresh}
        />
      ) : null}
      {costDialog ? (
        <CostDialog
          key={costDialog === 'new' ? 'new' : costDialog.id}
          job={job}
          row={costDialog === 'new' ? null : costDialog}
          today={today}
          open
          onOpenChange={(open) => (open ? undefined : setCostDialog(null))}
          onSaved={refresh}
        />
      ) : null}
      {priceOpen ? (
        <PriceDialog
          job={job}
          today={today}
          mode="material"
          open
          onOpenChange={(open) => (open ? undefined : setPriceOpen(false))}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}
