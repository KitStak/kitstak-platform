'use client';
/**
 * Dev only gallery of every chart with sample data: the happy path, plus zero, negative, single
 * point, gaps, long labels, loading, empty and error. Rendered by `/dev/charts` (never in
 * production) and shot by `scripts/charts-shots.mjs`. The numbers are made up and fixed.
 */
import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatMoney, formatMoneyDelta, formatMoneyWhole, formatPercentBp, formatPointsDelta } from '@/lib/format';
import { AreaChart, BarChart, ComboChart, LineChart, ParetoChart, WaterfallChart } from './cartesian';
import { BulletChart } from './bullet';
import { HeatmapCalendar, type HeatmapDay } from './heatmap';
import { DonutChart, Gauge, ProgressRing } from './radial';
import { shiftDate, weekdayOf } from './scale';
import { Sparkline } from './sparkline';
import { DeltaBadge, KpiTile, MarginPill, marginHealth } from './stats';

/** A fixed wave so server and browser draw the same picture. */
function wave(index: number, base: number, swing: number, drift = 0, phase = 0): number {
  return Math.round(base + drift * index + swing * Math.sin(index * 0.9 + phase) + swing * 0.45 * Math.cos(index * 2.3 + phase * 2));
}

const DAYS_30 = Array.from({ length: 30 }, (_, index) => shiftDate('2026-10-19', index));
const DAYS_90 = Array.from({ length: 90 }, (_, index) => shiftDate('2026-08-20', index));
const WEEKS_12 = Array.from({ length: 12 }, (_, index) => shiftDate('2026-08-31', index * 7));
const MONTHS_12 = ['2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];

const revenue30 = DAYS_30.map((_, index) => wave(index, 1_420_000, 260_000, 9_000));
const cost30 = DAYS_30.map((_, index) => wave(index, 1_050_000, 190_000, 11_000, 1.4));
const profit30 = revenue30.map((value, index) => value - cost30[index]!);
const margin90 = DAYS_90.map((_, index) => wave(index, 2450, 520, -6, 0.6));
const revenue12 = MONTHS_12.map((_, index) => wave(index, 31_200_000, 5_400_000, 620_000));
const margin12 = MONTHS_12.map((_, index) => wave(index, 2380, 610, 12, 2.1));
const units12 = WEEKS_12.map((_, index) => wave(index, 18_400, 3_100, 240));

const CLIENTS = ['Northwind Robotics', 'Harbor & Pine Outfitters', 'Bluebird Subscription Boxes International', 'Acme Home Goods', 'Solstice Skincare', 'Granite Peak Supplements', 'Lumen Audio'];

function heatDays(start: string, count: number, kind: 'units' | 'profit'): HeatmapDay[] {
  return Array.from({ length: count }, (_, index) => {
    const date = shiftDate(start, index);
    const weekday = weekdayOf(date);
    if (weekday === 0) return { date, value: null };
    if (kind === 'units') return { date, value: weekday === 6 ? (index % 3 === 0 ? 420 : 0) : Math.max(0, wave(index, 2600, 1500)) };
    return { date, value: weekday === 6 ? null : wave(index, 62_000, 150_000, 300, 0.4) };
  });
}

function Section({ id, title, note, children }: { readonly id: string; readonly title: string; readonly note: string; readonly children: ReactNode }) {
  return (
    <section data-gallery={id} className="rounded-xl bg-app p-4 sm:p-5">
      <header className="mb-4">
        <h2 className="text-md font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{note}</p>
      </header>
      {children}
    </section>
  );
}

function Tile({ title, note, children, className }: { readonly title: string; readonly note?: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={`min-w-0 rounded-lg border border-border-subtle bg-panel p-4 sm:p-5 ${className ?? ''}`}>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {note ? <p className="mt-0.5 mb-4 text-xs text-fg-muted">{note}</p> : <div className="mb-4" />}
      {children}
    </div>
  );
}

function Explain({ title, rows, note }: { readonly title: string; readonly rows: readonly (readonly [string, string])[]; readonly note: string }) {
  return (
    <Popover>
      <PopoverTrigger aria-label={`How we got this: ${title}`} className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
        <Info aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="text-sm font-semibold text-fg">How we got this</p>
        <dl className="mt-2 flex flex-col gap-1 text-xs">
          {rows.map(([name, value]) => (
            <div key={name} className="flex justify-between gap-3">
              <dt className="text-fg-secondary">{name}</dt>
              <dd className="font-medium text-fg tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-2xs text-fg-muted">{note}</p>
      </PopoverContent>
    </Popover>
  );
}

const GRID = 'grid grid-cols-1 gap-4 lg:grid-cols-2';

export function ChartGallery() {
  const [retries, setRetries] = useState(0);
  const profitTotal = profit30.reduce((sum, value) => sum + value, 0);
  const revenueTotal = revenue30.reduce((sum, value) => sum + value, 0);
  const costTotal = cost30.reduce((sum, value) => sum + value, 0);
  const marginBp = Math.round((profitTotal / revenueTotal) * 10000);
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-3 py-5 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-fg">Chart gallery</h1>
        <p className="mt-1 text-sm text-fg-muted">Every Pulse chart with sample numbers. This page only exists on a dev server.</p>
      </header>

      <Section id="stats" title="Stat helpers" note="KpiTile, DeltaBadge, MarginPill and Sparkline.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Profit on jobs"
            value={formatMoneyWhole(profitTotal)}
            delta={{ delta: 412_300, text: formatMoneyDelta(412_300, { cents: false }), label: 'vs last month' }}
            sparkline={{ values: profit30, format: 'money' }}
            explain={
              <Explain
                title="Profit on jobs"
                rows={[
                  ['Revenue', formatMoneyWhole(revenueTotal)],
                  ['Cost', formatMoneyWhole(costTotal)],
                  ['Profit', formatMoneyWhole(profitTotal)],
                ]}
                note="Profit is revenue minus cost for the dates you picked."
              />
            }
          />
          <KpiTile label="Labor cost" value={formatMoneyWhole(18_420_000)} delta={{ delta: 1_250_000, text: formatMoneyDelta(1_250_000, { cents: false }), goodWhen: 'down', label: 'vs last month' }} sparkline={{ values: cost30, format: 'money', tone: 'bad' }} />
          <KpiTile label="Margin" value={formatPercentBp(marginBp)} delta={{ delta: -180, text: formatPointsDelta(-180), label: 'vs last month' }} footer={<MarginPill health={marginHealth(marginBp, 3000)} size="sm" />} />
          <KpiTile label="Ready to bill" value={null} emptyText="Nothing to bill yet" />
          <KpiTile label="Loading tile" value={null} loading />
          <KpiTile label="Units shipped" value={null} error="We could not load this number. Try again in a minute." />
          <KpiTile label="A very long tile label that has to be cut off cleanly" value={formatMoney(123_456_789)} delta={{ delta: 0, text: formatMoneyDelta(0), label: 'vs the same four weeks last year' }} />
          <KpiTile label="Single point trend" value="42" sparkline={{ values: [42] }} delta={{ delta: null, text: '' }} />
        </div>
        <div className={`${GRID} mt-4`}>
          <Tile title="DeltaBadge and MarginPill" note="Arrows and icons carry the meaning, color only helps.">
            <div className="flex flex-wrap items-center gap-3">
              <DeltaBadge delta={4200} text={formatMoneyDelta(420_000, { cents: false })} label="vs last week" />
              <DeltaBadge delta={-310} text={formatPointsDelta(-310)} label="vs target" />
              <DeltaBadge delta={900} text={formatMoneyDelta(90_000, { cents: false })} goodWhen="down" label="cost" />
              <DeltaBadge delta={-12} text="-12 hours" goodWhen="down" size="sm" />
              <DeltaBadge delta={0} text="0%" />
              <DeltaBadge delta={null} text="" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <MarginPill health="healthy" marginBp={3410} />
              <MarginPill health="watch" marginBp={2640} />
              <MarginPill health="at_risk" marginBp={1380} />
              <MarginPill health="losing" marginBp={-420} />
              <MarginPill health="none" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <MarginPill status="on_track" size="sm" />
              <MarginPill status="heads_up" size="sm" />
              <MarginPill status="at_risk" size="sm" />
              <MarginPill status="losing" size="sm" />
              <MarginPill status="no_data" size="sm" />
            </div>
          </Tile>
          <Tile title="Sparkline" note="Up, down, across zero, gaps, one point, flat at zero and empty.">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs text-fg-secondary sm:grid-cols-4">
              {(
                [
                  ['Up', profit30.slice(0, 14), 'good'],
                  ['Down', [...profit30.slice(0, 14)].reverse().map((value, index) => value - index * 20_000), 'bad'],
                  ['Across zero', [40, 22, -10, -34, -8, 18, 44, 30], 'accent'],
                  ['Gaps', [12, 18, null, null, 25, 21, null, 30], 'accent'],
                  ['One point', [7], 'accent'],
                  ['Flat zero', [0, 0, 0, 0, 0], 'neutral'],
                  ['Empty', [], 'accent'],
                  ['All missing', [null, null, null], 'accent'],
                ] as const
              ).map(([name, values, tone]) => (
                <div key={name} className="flex flex-col gap-1">
                  <Sparkline values={values} label={name} tone={tone} format="number" />
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <Sparkline values={margin90} label="Margin, last 90 days" format="percent" fluid height={36} />
            </div>
          </Tile>
        </div>
      </Section>

      <Section id="line" title="LineChart and AreaChart" note="Many series, a time axis, a target line, gaps, one point and values under zero.">
        <div className={GRID}>
          <Tile title="Revenue, cost and profit by day" note="Three series over 30 days with a target.">
            <LineChart
              title="Revenue, cost and profit by day"
              description="Three lines over the last 30 days against the daily profit target."
              dates={DAYS_30}
              format="money"
              series={[
                { id: 'revenue', label: 'Revenue', values: revenue30 },
                { id: 'cost', label: 'Cost', values: cost30 },
                { id: 'profit', label: 'Profit', values: profit30 },
              ]}
              target={{ value: 450_000, label: 'Profit target' }}
              tableToggle
            />
          </Tile>
          <Tile title="Margin, last 90 days" note="A dense line in percent. The axis does not start at zero.">
            <LineChart title="Margin, last 90 days" dates={DAYS_90} format="percent" series={[{ id: 'margin', label: 'Margin', values: margin90 }]} target={{ value: 3000, label: 'Target' }} />
          </Tile>
          <Tile title="Units by week" note="AreaChart with weekly buckets.">
            <AreaChart title="Units by week" dates={WEEKS_12} bucket="week" format="number" series={[{ id: 'units', label: 'Good units', values: units12 }]} />
          </Tile>
          <Tile title="Profit with gaps and a loss" note="Missing days stay gaps. Values dip under zero.">
            <AreaChart
              title="Profit by day with gaps"
              dates={DAYS_30.slice(0, 16)}
              format="money"
              series={[{ id: 'profit', label: 'Profit', values: [120_000, 90_000, null, null, -60_000, -140_000, -20_000, 80_000, 150_000, null, 60_000, null, null, 210_000, 190_000, 240_000] }]}
            />
          </Tile>
          <Tile title="One point" note="A single day still draws.">
            <LineChart title="Revenue, one day" dates={['2026-11-17']} format="money" series={[{ id: 'revenue', label: 'Revenue', values: [1_840_000] }]} height={200} />
          </Tile>
          <Tile title="Two lines by month" note="Month buckets across a new year.">
            <LineChart
              title="Margin by month"
              dates={MONTHS_12}
              bucket="month"
              format="percent"
              series={[
                { id: 'kitting', label: 'Kitting', values: margin12 },
                { id: 'packaging', label: 'Contract packaging', values: margin12.map((value, index) => value - 400 + ((index * 137) % 500)) },
              ]}
              height={200}
            />
          </Tile>
        </div>
      </Section>

      <Section id="bar" title="BarChart" note="Vertical and horizontal, grouped and stacked, values under zero, long names and all zeros.">
        <div className={GRID}>
          <Tile title="Profit by job" note="One series with losses. Values print on the bars.">
            <BarChart
              title="Profit by job"
              labels={['J-1042', 'J-1043', 'J-1044', 'J-1045', 'J-1046', 'J-1047', 'J-1048', 'J-1049']}
              format="money"
              series={[{ id: 'profit', label: 'Profit', values: [1_240_000, 860_000, -310_000, 420_000, -184_000, 0, 1_910_000, 95_000] }]}
              signColors
              showValues
            />
          </Tile>
          <Tile title="Plan and actual by month" note="Grouped bars on a month axis with a target.">
            <BarChart
              title="Plan and actual revenue by month"
              dates={MONTHS_12.slice(4)}
              bucket="month"
              format="money"
              series={[
                { id: 'plan', label: 'Plan', values: revenue12.slice(4).map((value) => Math.round(value * 0.94)) },
                { id: 'actual', label: 'Actual', values: revenue12.slice(4) },
              ]}
              target={{ value: 36_000_000, label: 'Goal' }}
            />
          </Tile>
          <Tile title="Cost by week" note="Stacked, with a credit that goes under zero.">
            <BarChart
              title="Cost by week"
              dates={WEEKS_12}
              bucket="week"
              mode="stacked"
              format="money"
              series={[
                { id: 'labor', label: 'Labor', values: WEEKS_12.map((_, index) => wave(index, 4_200_000, 600_000)) },
                { id: 'material', label: 'Material', values: WEEKS_12.map((_, index) => wave(index, 2_600_000, 500_000, 0, 2)) },
                { id: 'shared', label: 'Time not on a job', values: WEEKS_12.map((_, index) => wave(index, 700_000, 200_000, 0, 4)) },
                { id: 'credits', label: 'Vendor credits', values: WEEKS_12.map((_, index) => (index % 4 === 2 ? -620_000 : 0)) },
              ]}
              showValues
            />
          </Tile>
          <Tile title="Profit by client, long names" note="Long names slant when the card is narrow.">
            <BarChart title="Profit by client" labels={CLIENTS} format="money" series={[{ id: 'profit', label: 'Profit', values: [4_210_000, 2_860_000, 2_240_000, 1_420_000, -390_000, 880_000, 310_000] }]} signColors />
          </Tile>
          <Tile title="Margin by client" note="Horizontal ranking with a target and a loss.">
            <BarChart
              title="Margin by client"
              orientation="horizontal"
              labels={CLIENTS}
              format="percent"
              series={[{ id: 'margin', label: 'Margin', values: [3410, 2890, 2640, 1920, -740, 1380, 310] }]}
              target={{ value: 3000, label: 'Target' }}
              signColors
            />
          </Tile>
          <Tile title="Cost to serve by client" note="Horizontal and stacked. Totals print at the ends.">
            <BarChart
              title="Cost to serve by client"
              orientation="horizontal"
              mode="stacked"
              labels={CLIENTS.slice(0, 5)}
              format="money"
              series={[
                { id: 'labor', label: 'Labor', values: [5_200_000, 3_100_000, 2_800_000, 1_900_000, 1_200_000] },
                { id: 'material', label: 'Material', values: [3_400_000, 2_600_000, 900_000, 1_100_000, 700_000] },
                { id: 'extra', label: 'Extra services', values: [800_000, 0, 1_400_000, 300_000, 150_000] },
              ]}
            />
          </Tile>
          <Tile title="Hours, plan and actual" note="Horizontal and grouped.">
            <BarChart
              title="Labor hours, plan and actual"
              orientation="horizontal"
              labels={['Kitting', 'Labeling', 'Shrink wrap', 'Returns']}
              format="hours"
              series={[
                { id: 'plan', label: 'Plan', values: [420, 260, 180, 90] },
                { id: 'actual', label: 'Actual', values: [465.5, 240, 212.25, null] },
              ]}
            />
          </Tile>
          <Tile title="All zeros and one bar" note="Nothing breaks when every value is zero or there is one bar.">
            <div className="grid grid-cols-2 gap-4">
              <BarChart title="Units by day, all zero" labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} series={[{ id: 'units', label: 'Units', values: [0, 0, 0, 0, 0] }]} height={160} />
              <BarChart title="Units, one day" labels={['Mon']} series={[{ id: 'units', label: 'Units', values: [12_480] }]} height={160} showValues />
            </div>
          </Tile>
        </div>
      </Section>

      <Section id="combo" title="ComboChart, WaterfallChart and ParetoChart" note="Bars with a line in another unit, a bridge from plan to actual, and biggest causes first.">
        <div className={GRID}>
          <Tile title="Revenue and margin by month" note="Split layout: two panels on one time axis.">
            <ComboChart
              title="Revenue and margin by month"
              description="Revenue bars with the margin percent line above them."
              dates={MONTHS_12}
              bucket="month"
              bars={[{ id: 'revenue', label: 'Revenue', values: revenue12 }]}
              lines={[{ id: 'margin', label: 'Margin', values: margin12 }]}
              barFormat="money"
              lineFormat="percent"
              lineTarget={{ value: 3000, label: 'Target' }}
            />
          </Tile>
          <Tile title="Revenue and margin, overlay" note="Overlay layout: the line reads the right axis.">
            <ComboChart
              title="Revenue and margin by month, overlay"
              dates={MONTHS_12}
              bucket="month"
              bars={[{ id: 'revenue', label: 'Revenue', values: revenue12 }]}
              lines={[{ id: 'margin', label: 'Margin', values: margin12 }]}
              barFormat="money"
              lineFormat="percent"
              layout="overlay"
            />
          </Tile>
          <Tile title="Why profit changed" note="From planned profit to actual profit.">
            <WaterfallChart
              title="Why profit changed"
              description="Each bar adds to or takes away from planned profit until it reaches actual profit."
              start={{ label: 'Planned profit', value: 4_800_000 }}
              steps={[
                { id: 'price', label: 'Price', value: 320_000 },
                { id: 'volume', label: 'Volume', value: 610_000 },
                { id: 'labor_rate', label: 'Labor rate', value: -280_000 },
                { id: 'labor_efficiency', label: 'Labor efficiency', value: -940_000 },
                { id: 'material', label: 'Material', value: -410_000 },
                { id: 'other', label: 'Other', value: 0 },
              ]}
              endLabel="Actual profit"
              format="money"
              tableToggle
            />
          </Tile>
          <Tile title="A bridge that ends under zero" note="Margin points from plan to actual.">
            <WaterfallChart
              title="Margin bridge"
              start={{ label: 'Planned margin', value: 1200 }}
              steps={[
                { id: 'price', label: 'Price', value: -300 },
                { id: 'labor', label: 'Labor efficiency', value: -1150 },
                { id: 'material', label: 'Material', value: -260 },
                { id: 'volume', label: 'Volume', value: 140 },
              ]}
              endLabel="Actual margin"
              format="percent"
            />
          </Tile>
          <Tile title="Where the extra cost came from" note="Pareto: the line is the running share of the total.">
            <ParetoChart
              title="Extra cost by cause"
              valueLabel="Extra cost"
              format="money"
              items={[
                { id: 'ot', label: 'Overtime', value: 1_840_000 },
                { id: 'rework', label: 'Rework', value: 1_210_000 },
                { id: 'scrap', label: 'Scrap', value: 760_000 },
                { id: 'wait', label: 'Waiting on parts', value: 540_000 },
                { id: 'setup', label: 'Long setups', value: 310_000 },
                { id: 'train', label: 'Training', value: 180_000 },
                { id: 'move', label: 'Moving stock', value: 120_000 },
                { id: 'clean', label: 'Cleanup', value: 90_000 },
                { id: 'misc1', label: 'Mislabels', value: 60_000 },
                { id: 'misc2', label: 'Lost time', value: 40_000 },
              ]}
            />
          </Tile>
          <Tile title="Pareto with one cause" note="One bar is the whole total.">
            <ParetoChart title="Scrap by cause" format="number" valueLabel="Units" items={[{ id: 'a', label: 'Torn boxes', value: 48 }]} height={200} />
          </Tile>
        </div>
      </Section>

      <Section id="radial" title="DonutChart, ProgressRing, Gauge and BulletChart" note="Share of a whole, how far along, and a number against its target.">
        <div className={GRID}>
          <Tile title="Cost by kind" note="Five slices with amounts and shares.">
            <DonutChart
              title="Cost by kind"
              format="money"
              centerLabel="total cost"
              slices={[
                { id: 'labor', label: 'Labor', value: 18_420_000 },
                { id: 'material', label: 'Material', value: 9_860_000 },
                { id: 'shared', label: 'Time not on a job', value: 3_120_000 },
                { id: 'extra', label: 'Extra services', value: 2_240_000 },
                { id: 'freight', label: 'Freight', value: 60_000 },
              ]}
            />
          </Tile>
          <Tile title="Revenue by client, many slices" note="Past six slices the tail folds into Other. A negative is left out.">
            <DonutChart
              title="Revenue by client"
              format="money"
              centerLabel="revenue"
              slices={[...CLIENTS.map((label, index) => ({ id: label, label, value: 9_000_000 - index * 1_150_000 })), { id: 'x', label: 'Credit memo', value: -400_000 }, { id: 'y', label: 'Walk in orders', value: 380_000 }]}
            />
          </Tile>
          <Tile title="Gauge" note="Margin against target: healthy, under target, losing money and no data.">
            <div className="grid grid-cols-1 justify-items-center gap-6 sm:grid-cols-2">
              <Gauge title="Margin this month" value={3410} target={3000} floor={1000} footer={<MarginPill health={marginHealth(3410, 3000)} />} />
              <Gauge title="Margin this week" value={2240} target={3000} floor={1000} footer={<MarginPill health={marginHealth(2240, 3000)} />} />
              <Gauge title="Margin on J-1044" value={-420} target={3000} floor={1000} footer={<MarginPill health={marginHealth(-420, 3000)} />} size={168} />
              <Gauge title="Margin on J-1050" value={null} target={3000} floor={1000} footer={<MarginPill health="none" />} size={168} />
            </div>
          </Tile>
          <Tile title="BulletChart and ProgressRing" note="Under target, over target, lower is better, zero and no data.">
            <div className="flex flex-col gap-4">
              <BulletChart label="Units this week" value={15_640} target={18_000} format="number" />
              <BulletChart label="Revenue this month" value={39_800_000} target={36_000_000} format="money" />
              <BulletChart label="Labor hours on J-1042" value={312.5} target={250} format="hours" goodWhen="down" targetLabel="Plan" />
              <BulletChart label="Scrap units" value={0} target={120} format="number" goodWhen="down" targetLabel="Limit" />
              <BulletChart label="Ready to bill" value={null} target={5_000_000} format="money" />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-5">
              <ProgressRing value={0} label="Not started" />
              <ProgressRing value={38} label="Units done" />
              <ProgressRing value={72} label="Hours used" tone="watch" />
              <ProgressRing value={100} label="Job done" />
              <ProgressRing value={130} label="Over plan" tone="bad" />
              <ProgressRing value={6420} max={10_000} label="Units packed" size={96}>
                <span className="flex flex-col items-center leading-tight">
                  <span>64%</span>
                  <span className="text-2xs font-normal text-fg-muted">6,420 units</span>
                </span>
              </ProgressRing>
              <ProgressRing value={45} label="Small ring" size={32} hideValue />
            </div>
          </Tile>
        </div>
      </Section>

      <Section id="heatmap" title="HeatmapCalendar" note="One cell for each day. Weeks turn into rows when the card is narrow.">
        <div className="grid grid-cols-1 gap-4">
          <div className={GRID}>
            <Tile title="Units by day, 13 weeks" note="One hue from light to strong. Hollow cells have no data.">
              <HeatmapCalendar title="Units by day" days={heatDays('2026-08-17', 91, 'units')} format="number" valueLabel="Good units" />
            </Tile>
            <Tile title="Profit by day, 8 weeks" note="Two hues around zero for days that lost money.">
              <HeatmapCalendar title="Profit by day" days={heatDays('2026-09-21', 56, 'profit')} format="money" valueLabel="Profit" lowLabel="Loss" highLabel="Profit" />
            </Tile>
          </div>
          <Tile title="Profit by day, one year" note="A full year fits a wide card.">
            <HeatmapCalendar title="Profit by day, last year" days={heatDays('2025-11-17', 365, 'profit')} format="money" valueLabel="Profit" lowLabel="Loss" highLabel="Profit" tableToggle />
          </Tile>
        </div>
      </Section>

      <Section id="states" title="States" note="Loading, empty, error with a retry, and a refetch that keeps its place.">
        <div className={GRID}>
          <Tile title="Loading">
            <LineChart title="Profit by day" loading dates={[]} series={[]} height={180} />
          </Tile>
          <Tile title="Empty">
            <BarChart title="Profit by job" labels={[]} series={[]} height={180} emptyTitle="No jobs with profit yet" emptyHint="Log work and revenue on a job and its profit shows up here." />
          </Tile>
          <Tile title="Error" note={retries > 0 ? `Tried again ${retries} ${retries === 1 ? 'time' : 'times'}.` : undefined}>
            <AreaChart title="Units by week" error="Check your connection and try again." onRetry={() => setRetries((count) => count + 1)} dates={[]} series={[]} height={180} />
          </Tile>
          <Tile title="Refreshing">
            <BarChart title="Units by day" refreshing labels={['Mon', 'Tue', 'Wed', 'Thu', 'Fri']} series={[{ id: 'units', label: 'Units', values: [2400, 2900, 2100, 3300, 2800] }]} height={180} format="number" />
          </Tile>
          <Tile title="Empty donut and heatmap">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DonutChart title="Cost by kind" slices={[]} emptyTitle="No cost yet" emptyHint="Costs show up once work is logged." />
              <HeatmapCalendar title="Units by day" days={[]} emptyTitle="No days logged" emptyHint="Each day you log work fills a cell." />
            </div>
          </Tile>
          <Tile title="Loading gauge and bullet">
            <div className="flex flex-wrap items-center gap-6">
              <Gauge title="Margin" value={null} target={3000} loading size={168} />
              <BulletChart label="Units this week" value={null} target={100} loading className="min-w-[12rem] flex-1" />
            </div>
          </Tile>
        </div>
      </Section>
    </div>
  );
}
