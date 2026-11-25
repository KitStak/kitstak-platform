'use client';
/**
 * Share a production report (docs/programs/SPEC.md 5.20): `?report=<runId>` or `?report=week:YYYY-MM-DD`.
 * Pick the range (this run, a week), the format (PDF or CSV) and whether to include charges
 * (money access only, off by default). Downloads from `/api/v1/programs/KEY/report`, which lists
 * planned, built and scrap by variant and never shows money unless charges are on.
 */
import { useMemo, useState } from 'react';
import { Copy, Download, FileBarChart } from 'lucide-react';
import { addDays, startOfWeek } from '@kitstak/programs-engine';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, IconButton, IsoDatePicker, Switch, ToggleGroup, toast } from '@/components/ui';
import { useProgram } from '@/lib/hooks/use-programs';
import type { IsoDate } from '@/lib/program-types';
import { rangeLabel } from '../kit/format';

type Scope = 'run' | 'week';

function parseTarget(target: string, today: IsoDate): { scope: Scope; runId: string | null; week: IsoDate } {
  if (target.startsWith('run:')) {
    const date = target.slice(-10);
    return { scope: 'run', runId: target, week: startOfWeek(/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today, 1) };
  }
  const day = target.startsWith('week:') ? target.slice(5) : today;
  return { scope: 'week', runId: null, week: startOfWeek(/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today, 1) };
}

export function reportHref(programKey: string, options: { readonly runId?: string | null; readonly week?: IsoDate | null; readonly charges: boolean; readonly format: 'pdf' | 'csv' }): string {
  const search = new URLSearchParams();
  if (options.runId) search.set('run', options.runId);
  else if (options.week) search.set('week', options.week);
  search.set('charges', options.charges ? '1' : '0');
  search.set('format', options.format);
  return `/api/v1/programs/${encodeURIComponent(programKey)}/report?${search.toString()}`;
}

export function ShareReportDialog({ programKey, target, onClose }: { readonly programKey: string; readonly target: string; readonly onClose: () => void }) {
  const program = useProgram(programKey, { staleTime: 30_000 });
  const today = program.data?.calendar.today ?? new Date().toISOString().slice(0, 10);
  const initial = useMemo(() => parseTarget(target, today), [target, today]);
  const [scope, setScope] = useState<Scope>(initial.scope);
  const [week, setWeek] = useState<IsoDate>(initial.week);
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [charges, setCharges] = useState(false);
  const seesMoney = Boolean(program.data && !program.data.moneyHidden && program.data.capabilities.seesMoney);
  const href = reportHref(programKey, { runId: scope === 'run' ? initial.runId : null, week: scope === 'week' ? week : null, charges: charges && seesMoney, format });
  const runDate = initial.runId ? initial.runId.slice(-10) : null;
  const scopes = [...(initial.runId ? [{ value: 'run' as const, label: 'This run' }] : []), { value: 'week' as const, label: 'A week' }];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" data-testid="share-report-dialog">
        <DialogHeader title="Share a production report" description="Planned, built and scrap by variant. Money shows only when you include charges." icon={<FileBarChart aria-hidden className="size-5 text-icon" />} />
        <DialogBody className="flex flex-col gap-5 pb-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-fg-secondary">Range</span>
            <ToggleGroup<Scope> label="Range" value={scope} onValueChange={setScope} options={scopes} className="w-fit" />
            {scope === 'run' && runDate ? <p className="text-sm text-fg-secondary">The run on {rangeLabel(runDate, runDate)}.</p> : null}
            {scope === 'week' ? (
              <div className="flex items-center gap-2">
                <span className="w-52">
                  <IsoDatePicker value={week} onChange={(value) => value && setWeek(startOfWeek(value, 1))} />
                </span>
                <span className="text-sm text-fg-secondary">{rangeLabel(week, addDays(week, 6))}</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-fg-secondary">Format</span>
            <ToggleGroup<'pdf' | 'csv'>
              label="Format"
              value={format}
              onValueChange={setFormat}
              options={[
                { value: 'pdf', label: 'PDF' },
                { value: 'csv', label: 'CSV' },
              ]}
              className="w-fit"
            />
          </div>
          {seesMoney ? (
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border-subtle p-3">
              <span>
                <span className="block text-sm font-medium text-fg">Include charges</span>
                <span className="block text-xs text-fg-muted">Adds revenue by variant. Leave it off for a report you send to the floor or the customer.</span>
              </span>
              <Switch checked={charges} onCheckedChange={setCharges} aria-label="Include charges" />
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <IconButton
            label="Copy link"
            icon={<Copy aria-hidden />}
            className="mr-auto"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}${href}`).then(
                () => toast.success('Link copied', 'People with access to this program can open it.'),
                () => toast.error("Couldn't copy the link"),
              );
            }}
          />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <a href={href} download onClick={() => window.setTimeout(onClose, 300)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-focus" data-testid="report-download">
            <Download aria-hidden className="size-4" />
            Download {format.toUpperCase()}
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
