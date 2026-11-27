'use client';
/**
 * Materials: who buys the parts, how material is costed (a cost per unit, or the parts really
 * used), the usage rows with scrap, and the other costs of the job (freight, pallets, outside
 * help). Every row can be added, edited and deleted with undo.
 */
import { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, ToggleGroup, toast } from '@/components/ui';
import { StatRow, StatTile } from '@kitstak/ui/dashboard';
import { statValue } from '@/components/charts/stats';
import { routes } from '@/lib/routes';
import { Panel } from '@/components/layout/page';
import { CostLedger } from '@/features/costs/cost-ledger';
import { MaterialLedger } from '@/features/materials/material-ledger';
import { useShell } from '@/features/shell/shell-context';
import { formatMoney, formatNumber, formatPercentBp, formatUnitPrice } from '@/lib/format';
import { scrapUnitsBp } from '@/lib/profit';
import { shortDate } from '@/lib/profit/calendar';
import type { JobPriceDTO } from '@/lib/types';
import { updateJobAction } from '@/server/actions/jobs';
import { PriceDialog } from './forms/job-dialogs';
import { useJobCosts, useJobUsage, useRefreshJob } from './job-data';
import { singularUnit } from './job-math';
import type { JobTabProps } from './job-overview';
import { Explain } from './job-ui';
import { callAction } from './use-job-actions';

export function JobMaterials({ job, today }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const seesMoney = shell.seesMoney && !job.stats.moneyHidden;
  const canManage = shell.can('job:manage');
  const unit = singularUnit(job.unitLabel);
  const usage = useJobUsage(job.id);
  const costs = useJobCosts(job.id, seesMoney);
  const [priceOpen, setPriceOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const usageRows = useMemo(() => (usage.data ?? []).filter((row) => row.deletedAt === null), [usage.data]);
  const costRows = useMemo(() => (costs.data ?? []).filter((row) => row.deletedAt === null), [costs.data]);
  // A job that does not say who buys the parts follows its client, then the workspace default.
  const partsOwner = job.partsOwner ?? job.inheritedPartsOwner ?? 'us';
  const ownerInherited = job.partsOwner === null;
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
      <StatRow label="Material numbers">
        {seesMoney ? (
          <StatTile
            label="Material cost so far"
            href={null}
            value={statValue(partsOwner === 'client' && (job.stats.materialCents ?? 0) === 0
                ? 'Client supplies'
                : formatMoney(job.stats.materialCents, { cents: false }))}
            caption={
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
        <StatTile
          label="Scrapped"
          href={routes.jobTab(job.number, 'work')}
          explain={
            <Explain
              title="Scrapped"
              rule="Units logged as scrap on the work log. The share is scrapped units over everything made, good and scrapped."
              rows={[
                { label: 'Good units', value: formatNumber(job.stats.unitsGood, { maxDigits: 0 }) },
                { label: 'Scrapped units', value: formatNumber(job.stats.unitsScrap, { maxDigits: 0 }) },
                { label: 'Share scrapped', value: scrapBp === null ? 'No units yet' : formatPercentBp(scrapBp), kind: 'total' },
              ]}
            />
          }
          value={statValue(formatNumber(job.stats.unitsScrap, { maxDigits: 0 }))}
          caption={
            <span className="text-xs text-fg-muted">
              {scrapBp === null ? 'no units yet' : `${formatPercentBp(scrapBp)} of what was made`}
            </span>
          }
        />
        {seesMoney ? (
          <StatTile
            label="Other costs so far"
            href={null}
            explain={
              <Explain
                title="Other costs so far"
                rule="Every row in the list of other costs on this job, added up. A credit, typed with a minus sign, takes away from the total."
                rows={[
                  { label: `${costRows.length} ${costRows.length === 1 ? 'row' : 'rows'}`, value: formatMoney(job.stats.otherCents), kind: 'total' },
                ]}
              />
            }
            value={statValue(formatMoney(job.stats.otherCents, { cents: false }))}
            caption={
              <span className="text-xs text-fg-muted">
                {costRows.length} {costRows.length === 1 ? 'row' : 'rows'}
              </span>
            }
          />
        ) : null}
        <StatTile
          label="Usage rows"
          href={null}
          explain={
            <Explain
              title="Usage rows"
              rule={
                job.materialMethod === 'actual'
                  ? 'A count of the rows under Material used. This job costs material from these rows, so each one moves the material cost.'
                  : 'A count of the rows under Material used. This job costs material by a cost for each unit, so these rows are for your records and for scrap.'
              }
              rows={[{ label: 'Rows under Material used', value: formatNumber(usageRows.length), kind: 'total' }]}
            />
          }
          value={statValue(formatNumber(usageRows.length))}
          caption={
            <span className="text-xs text-fg-muted">
              {job.materialMethod === 'actual' ? 'these set the material cost' : 'for your records'}
            </span>
          }
        />
      </StatRow>

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
              {ownerInherited ? ' This job follows the setting of its client or your workspace. Pick one here to set it for this job only.' : ''}
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

      <div id="parts-used" className="scroll-mt-24">
        <MaterialLedger jobId={job.id} jobRef={job.number} today={today} title="Material used" recordsOnly={job.materialMethod === 'standard'} />
      </div>
      {seesMoney ? (
        <div id="other-costs" className="scroll-mt-24">
          <CostLedger scope="job" jobId={job.id} today={today} title="Other costs on this job" />
        </div>
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
