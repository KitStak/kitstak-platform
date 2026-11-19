/**
 * Renders every chart to static markup at a fixed width (no browser needed) and checks what a
 * screen reader gets: a title, a description, a data table with the real numbers, the empty,
 * loading and error states, and no NaN in any path.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BulletChart, bulletReading } from './bullet';
import { AreaChart, BarChart, ComboChart, LineChart, ParetoChart, WaterfallChart } from './cartesian';
import { ChartGallery } from './gallery';
import { HeatmapCalendar, heatStep } from './heatmap';
import { DonutChart, Gauge, ProgressRing } from './radial';
import { Sparkline, sparklineSummary } from './sparkline';
import { DeltaBadge, KpiTile, MarginPill, healthFromStatus, marginHealth } from './stats';

vi.mock('./charts.css', () => ({}));

const W = 640;
const html = (node: React.ReactElement): string => renderToStaticMarkup(node);
const clean = (markup: string): void => {
  expect(markup).not.toContain('NaN');
  expect(markup).not.toContain('undefined');
  expect(markup).not.toContain('Infinity');
};

describe('cartesian charts', () => {
  it('LineChart has a title, a description, a legend and a table', () => {
    const markup = html(
      <LineChart
        width={W}
        title="Profit by day"
        description="Profit for each day."
        dates={['2026-11-01', '2026-11-02', '2026-11-03']}
        format="money"
        series={[
          { id: 'a', label: 'Kitting', values: [120_000, null, 180_000] },
          { id: 'b', label: 'Labeling', values: [90_000, 70_000, -20_000] },
        ]}
        target={{ value: 150_000, label: 'Target' }}
      />,
    );
    clean(markup);
    expect(markup).toContain('<title');
    expect(markup).toContain('Profit by day');
    expect(markup).toContain('<desc');
    expect(markup).toContain('Use the arrow keys');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('<table');
    expect(markup).toContain('Sun, Nov 1, 2026');
    expect(markup).toContain('$1,200');
    expect(markup).toContain('No data');
    expect(markup).toContain('-$200.00');
    expect(markup).toContain('Target $1.5K');
    expect(markup).toContain('Kitting');
  });

  it('draws one point, all zeros and negative only data', () => {
    clean(html(<LineChart width={W} title="One" dates={['2026-11-01']} series={[{ id: 'a', label: 'A', values: [5] }]} />));
    clean(html(<AreaChart width={W} title="Zero" labels={['a', 'b']} series={[{ id: 'a', label: 'A', values: [0, 0] }]} />));
    clean(html(<BarChart width={W} title="Neg" labels={['a', 'b']} series={[{ id: 'a', label: 'A', values: [-5, -9] }]} signColors showValues />));
    clean(html(<BarChart width={120} title="Tiny" labels={['Alpha Beta Gamma', 'Delta Epsilon']} series={[{ id: 'a', label: 'A', values: [1, 2] }]} />));
  });

  it('BarChart handles grouped, stacked and horizontal', () => {
    const series = [
      { id: 'plan', label: 'Plan', values: [10, 20, -5] },
      { id: 'actual', label: 'Actual', values: [12, null, 4] },
    ];
    for (const mode of ['grouped', 'stacked'] as const) {
      for (const orientation of ['vertical', 'horizontal'] as const) {
        const markup = html(<BarChart width={W} title="Bars" labels={['A', 'B', 'C']} series={series} mode={mode} orientation={orientation} showValues />);
        clean(markup);
        expect(markup).toContain('Plan');
        expect(markup).toContain('<table');
      }
    }
    expect(html(<BarChart width={W} title="Bars" labels={['A', 'B', 'C']} series={series} mode="stacked" orientation="horizontal" />)).toContain('Total');
  });

  it('shows the teaching empty state, loading and error', () => {
    const empty = html(<BarChart width={W} title="Bars" labels={[]} series={[]} emptyTitle="No jobs yet" emptyHint="Add a job." />);
    expect(empty).toContain('No jobs yet');
    expect(empty).toContain('Add a job.');
    expect(empty).not.toContain('<svg width');
    const allMissing = html(<LineChart width={W} title="Line" labels={['a']} series={[{ id: 'a', label: 'A', values: [null] }]} />);
    expect(allMissing).toContain('Nothing to chart yet');
    const loading = html(<LineChart width={W} title="Line" loading labels={[]} series={[]} />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Loading Line');
    const error = html(<LineChart width={W} title="Line" error="Check your connection." onRetry={() => {}} labels={[]} series={[]} />);
    expect(error).toContain('role="alert"');
    expect(error).toContain('Try again');
  });

  it('ComboChart lists bars and lines in both layouts', () => {
    for (const layout of ['split', 'overlay'] as const) {
      const markup = html(
        <ComboChart width={W} title="Revenue and margin" layout={layout} dates={['2026-09-01', '2026-10-01']} bucket="month" bars={[{ id: 'r', label: 'Revenue', values: [3_000_000, 3_400_000] }]} lines={[{ id: 'm', label: 'Margin', values: [2200, 2600] }]} barFormat="money" lineFormat="percent" />,
      );
      clean(markup);
      expect(markup).toContain('September 2026');
      expect(markup).toContain('$34,000');
      expect(markup).toContain('26%');
    }
  });

  it('WaterfallChart adds up from start to end', () => {
    const markup = html(
      <WaterfallChart
        width={W}
        title="Why profit changed"
        start={{ label: 'Planned profit', value: 100_000 }}
        steps={[
          { id: 'price', label: 'Price', value: 20_000 },
          { id: 'labor', label: 'Labor efficiency', value: -50_000 },
          { id: 'other', label: 'Other', value: 0 },
        ]}
        endLabel="Actual profit"
        format="money"
      />,
    );
    clean(markup);
    expect(markup).toContain('+$200.00');
    expect(markup).toContain('-$500.00');
    expect(markup).toContain('Running total');
    expect(markup).toContain('$700.00');
    expect(markup).toContain('Actual profit');
  });

  it('ParetoChart sorts, folds the tail and reaches 100%', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, label: `Cause ${index}`, value: (index + 1) * 10 }));
    const markup = html(<ParetoChart width={W} title="Causes" items={[...items, { id: 'neg', label: 'Negative', value: -5 }]} maxItems={5} />);
    clean(markup);
    expect(markup.indexOf('Cause 9')).toBeLessThan(markup.indexOf('Cause 8'));
    expect(markup).toContain('Other (6)');
    expect(markup).toContain('100%');
    expect(markup).not.toContain('Negative');
    expect(html(<ParetoChart width={W} title="Causes" items={[]} />)).toContain('Nothing to chart yet');
  });
});

describe('round and small charts', () => {
  it('DonutChart folds past six slices and leaves out values at or under zero', () => {
    const slices = Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, label: `Slice ${index}`, value: 100 - index * 10 }));
    const markup = html(<DonutChart width={W} title="Share" slices={[...slices, { id: 'z', label: 'Zero', value: 0 }]} />);
    clean(markup);
    expect(markup).toContain('Other (4)');
    expect(markup).toContain('1 item at or under zero is left out.');
    expect(markup).toContain('<table');
    expect(html(<DonutChart width={W} title="Share" slices={[{ id: 'a', label: 'A', value: 0 }]} />)).toContain('Nothing to chart yet');
    clean(html(<DonutChart width={W} title="Share" slices={[{ id: 'a', label: 'Only', value: 5 }]} />));
  });

  it('HeatmapCalendar keeps missing days apart from zero', () => {
    const markup = html(
      <HeatmapCalendar
        width={W}
        title="Profit by day"
        format="money"
        valueLabel="Profit"
        days={[
          { date: '2026-11-02', value: 50_000 },
          { date: '2026-11-03', value: -20_000 },
          { date: '2026-11-04', value: 0 },
          { date: '2026-11-06', value: null },
        ]}
      />,
    );
    clean(markup);
    expect(markup).toContain('Thu, Nov 5, 2026');
    expect(markup).toContain('No data');
    expect(markup).toContain('-$200.00');
    expect(markup).toContain('Below zero');
    expect(heatStep(0, 10)).toBe(0);
    expect(heatStep(10, 10)).toBe(4);
    expect(heatStep(-1, 10)).toBe(1);
    expect(heatStep(5, 0)).toBe(0);
  });

  it('Sparkline says the trend in words', () => {
    expect(sparklineSummary([1, 2, 3], 'Units', 'number')).toBe('Units: trending up, from 1 to 3. Low 1, high 3.');
    expect(sparklineSummary([], 'Units')).toBe('Units: no data yet');
    expect(sparklineSummary([4], 'Units', 'number')).toBe('Units: one point, 4');
    for (const values of [[1, 2, 3], [5], [], [null, null], [0, 0, 0], [-4, 3, null, 9]]) clean(html(<Sparkline values={values} label="Trend" />));
  });

  it('Gauge, ProgressRing and BulletChart speak their reading', () => {
    const gauge = html(<Gauge title="Margin" value={2240} target={3000} floor={1000} />);
    clean(gauge);
    expect(gauge).toContain('Margin: 22.4%, under target. Target 30%.');
    expect(html(<Gauge title="Margin" value={-400} target={3000} floor={1000} />)).toContain('under the floor');
    expect(html(<Gauge title="Margin" value={null} target={3000} />)).toContain('no data yet');
    expect(html(<ProgressRing value={130} label="Hours" />)).toContain('Hours: 130%, past the goal');
    clean(html(<ProgressRing value={Number.NaN} max={0} label="Bad" />));
    expect(bulletReading(80, 100)).toEqual({ met: false, text: '80% of target' });
    expect(bulletReading(80, 100, 'down', 'Plan')).toEqual({ met: true, text: '80% of plan' });
    expect(bulletReading(null, 100).text).toBe('No data yet');
    expect(bulletReading(5, 0).text).toBe('No target set');
    const bullet = html(<BulletChart label="Units" value={-5} target={100} format="number" />);
    clean(bullet);
    expect(bullet).toContain('Units: -5, -5% of target. Target 100.');
  });
});

describe('stat helpers', () => {
  it('MarginPill always pairs an icon with words', () => {
    for (const health of ['healthy', 'watch', 'at_risk', 'losing', 'none'] as const) {
      const markup = html(<MarginPill health={health} />);
      expect(markup).toContain('<svg');
      expect(markup).toMatch(/Healthy|Watch|At risk|Losing money|Not enough data/);
    }
    expect(html(<MarginPill status="heads_up" />)).toContain('Heads up');
    expect(html(<MarginPill health="watch" marginBp={2236} />)).toContain('22.4%');
    expect(healthFromStatus('on_track')).toBe('healthy');
  });

  it('marginHealth follows the shared risk lines', () => {
    expect(marginHealth(null, 3000)).toBe('none');
    expect(marginHealth(-1, 3000)).toBe('losing');
    expect(marginHealth(900, 3000)).toBe('at_risk');
    expect(marginHealth(1900, 3000)).toBe('at_risk');
    expect(marginHealth(2000, 3000)).toBe('watch');
    expect(marginHealth(3000, 3000)).toBe('healthy');
    expect(marginHealth(1500, 1500)).toBe('healthy');
  });

  it('DeltaBadge reads direction and tone without color', () => {
    expect(html(<DeltaBadge delta={5} text="+5%" />)).toContain('Up, better:');
    expect(html(<DeltaBadge delta={5} text="+$5" goodWhen="down" />)).toContain('Up, worse:');
    expect(html(<DeltaBadge delta={0} text="0%" />)).toContain('No change:');
    expect(html(<DeltaBadge delta={null} text="" />)).toContain('No change yet');
  });

  it('KpiTile shows value, empty, loading and error', () => {
    const tile = html(<KpiTile label="Profit" value="$1,200" delta={{ delta: 3, text: '+3%', label: 'vs last month' }} sparkline={{ values: [1, 2, 3] }} explain={<button type="button">How we got this</button>} />);
    expect(tile).toContain('$1,200');
    expect(tile).toContain('vs last month');
    expect(tile).toContain('How we got this');
    expect(html(<KpiTile label="Profit" value={null} emptyText="No profit yet" />)).toContain('No profit yet');
    expect(html(<KpiTile label="Profit" value={null} loading />)).toContain('Loading Profit');
    // While the number to compare with loads, the tile keeps room for the change so it does not grow later.
    const pending = html(<KpiTile label="Profit" value="$1,200" deltaPending />);
    expect(pending).toContain('data-testid="kpi-delta-pending"');
    expect(html(<KpiTile label="Profit" value="$1,200" deltaPending delta={{ delta: 3, text: '+3%', label: 'vs before' }} />)).not.toContain('kpi-delta-pending');
    expect(html(<KpiTile label="Profit" value={null} deltaPending />)).not.toContain('kpi-delta-pending');
    expect(html(<KpiTile label="Profit" value={null} error="Could not load." />)).toContain('role="alert"');
  });
});

describe('gallery', () => {
  it('renders every sample without bad numbers', () => {
    const markup = html(<ChartGallery />);
    clean(markup);
    expect(markup).not.toContain('—');
    expect(markup).not.toContain('–');
  });
});
