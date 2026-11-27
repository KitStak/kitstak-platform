import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ActionRow,
  Count,
  DashboardFrame,
  DashboardHeader,
  DashboardLinkProvider,
  DashSection,
  Delta,
  EmptyNote,
  Legend,
  Meter,
  Pill,
  StatRow,
  StatTile,
  Tag,
  statColumns,
  type DashLinkProps,
} from './index';

const css = fs.readFileSync(path.join(__dirname, 'dashboard.css'), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('stylesheet contract (docs/design/UI-CLEANUP.md)', () => {
  it('never draws gradients, glows or inset highlights', () => {
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/inset\s/);
    expect(css).not.toMatch(/drop-shadow|text-shadow/);
  });

  it('never uses crimson for data or status', () => {
    expect(css).not.toMatch(/var\(--primary/);
    expect(css).not.toMatch(/--brand-red/);
  });

  it('keeps pills flat: no border, no shadow, sentence case', () => {
    const pill = rule('.ks-dash-pill');
    expect(pill).toMatch(/border: 0;/);
    expect(pill).toMatch(/box-shadow: none;/);
    expect(pill).toMatch(/text-transform: none;/);
    expect(pill).toMatch(/height: 20px;/);
  });

  it('draws meters in the app data color by default', () => {
    expect(rule('.ks-dash-meter-fill')).toMatch(/background: var\(--dash-data/);
  });

  it('works outside a frame: every feel variable has a fallback', () => {
    // List pages use tiles, sections and pills without a DashboardFrame around them.
    expect(css).not.toMatch(/var\(--dash-[a-z-]+\)/);
  });

  it('gives every app its own data color and nothing more', () => {
    for (const app of ['portal', 'crm', 'wms', 'projects', 'pulse']) {
      expect(rule(`.ks-dash[data-app='${app}']`)).toMatch(/--dash-data: var\(--(chart|label|pulse-series)-/);
    }
  });
});

describe('StatTile', () => {
  it('is a link to the list it counts', () => {
    const html = renderToStaticMarkup(<StatTile label="Revenue" value="$518,830" href="/profit?metric=revenue" />);
    expect(html).toContain('<a href="/profit?metric=revenue" class="ks-dash-stat-link"');
    expect(html).toContain('data-linked=""');
    expect(html).toContain('$518,830');
  });

  it('renders without a link only when told there is nowhere to go', () => {
    const html = renderToStaticMarkup(<StatTile label="Revenue" value="$1" href={null} />);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('data-linked');
  });

  it('puts a short explanation in the tooltip, not an icon', () => {
    const html = renderToStaticMarkup(<StatTile label="Cost" value="$1" href="/c" help="Labor, material and other costs" />);
    expect(html).toContain('title="Labor, material and other costs"');
    expect(html).not.toContain('<svg');
  });

  it('keeps the explain control outside the link', () => {
    const html = renderToStaticMarkup(<StatTile label="Cost" value="$1" href="/c" explain={<button type="button">How we got this</button>} />);
    expect(html).toMatch(/<\/a><span class="ks-dash-stat-explain"><button/);
  });

  it('lays six tiles out as three and three, never a lonely tile', () => {
    expect(statColumns(6)).toBe(3);
    expect(statColumns(4)).toBe(4);
    expect(statColumns(8)).toBe(4);
    expect(statColumns(2)).toBe(2);
    const html = renderToStaticMarkup(
      <StatRow>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <StatTile key={n} label={`T${n}`} value={n} href={`/t/${n}`} />
        ))}
      </StatRow>,
    );
    expect(html).toContain('data-cols="3"');
  });

  it('shows a change as text with an arrow, with words for screen readers', () => {
    const html = renderToStaticMarkup(
      <StatTile label="Profit" value="$139,290" href="/p" delta={{ text: '+$18,799', direction: 'up', tone: 'good' }} />,
    );
    expect(html).toContain('data-tone="good"');
    expect(html).toContain('Up, better:');
    expect(html).toContain('+$18,799');
  });
});

describe('Delta', () => {
  it('says worse when the change is bad', () => {
    expect(renderToStaticMarkup(<Delta text="-6%" direction="down" tone="bad" />)).toContain('Down, worse:');
  });
});

describe('Pill, Tag, Count, Legend', () => {
  it('renders one marker: an icon wins over nothing, a dot when asked', () => {
    expect(renderToStaticMarkup(<Pill tone="critical">Losing money</Pill>)).not.toContain('ks-dash-pill-dot');
    expect(renderToStaticMarkup(<Pill tone="positive" dot>Running</Pill>)).toContain('ks-dash-pill-dot');
    const withIcon = renderToStaticMarkup(
      <Pill tone="caution" icon={<svg />}>
        At risk
      </Pill>,
    );
    expect(withIcon).toContain('ks-dash-pill-icon');
    expect(withIcon).not.toContain('ks-dash-pill-dot');
  });

  it('carries the tone as data, not as a class list', () => {
    expect(renderToStaticMarkup(<Pill tone="caution">At risk</Pill>)).toContain('data-tone="caution"');
    expect(renderToStaticMarkup(<Pill>Draft</Pill>)).toContain('data-tone="neutral"');
  });

  it('keeps tags neutral', () => {
    expect(renderToStaticMarkup(<Tag>J-1026</Tag>)).toBe('<span class="ks-dash-tag">J-1026</span>');
  });

  it('hides a zero count and caps big ones', () => {
    expect(renderToStaticMarkup(<Count value={0} />)).toBe('');
    expect(renderToStaticMarkup(<Count value={250} tone="critical" />)).toContain('99+');
  });

  it('draws a legend as dots and words', () => {
    const html = renderToStaticMarkup(<Legend items={[{ label: 'Open', color: 'var(--chart-1)' }]} />);
    expect(html).toContain('ks-dash-legend-dot');
    expect(html).not.toContain('ks-dash-pill');
  });
});

describe('Meter', () => {
  it('clamps and reports the value', () => {
    expect(renderToStaticMarkup(<Meter value={1.7} label="Packed" />)).toContain('aria-valuenow="100"');
    expect(renderToStaticMarkup(<Meter value={Number.NaN} label="Packed" />)).toContain('aria-valuenow="0"');
    expect(renderToStaticMarkup(<Meter value={0.42} label="Packed" />)).toContain('width:42%');
  });
});

describe('DashSection, ActionRow and EmptyNote', () => {
  it('renders the header action as a real link', () => {
    const html = renderToStaticMarkup(
      <DashSection title="Jobs that need you" action={{ label: 'All open jobs', href: '/jobs?open=1' }}>
        <p>body</p>
      </DashSection>,
    );
    expect(html).toContain('<h2');
    expect(html).toContain('href="/jobs?open=1"');
    expect(html).toContain('All open jobs');
  });

  it('makes the whole row a link with fixed value and pill columns', () => {
    const html = renderToStaticMarkup(
      <ActionRow href="/jobs/J-1026" tag="J-1026" title="Orchard Pet Supply chew toy" value="-$4,662" valueTone="critical" pill={<Pill tone="critical">Losing money</Pill>} />,
    );
    expect(html).toContain('href="/jobs/J-1026"');
    expect(html).toContain('class="ks-dash-row-value" data-tone="critical"');
    expect(html).toContain('ks-dash-row-pill');
  });

  it('names the next step in an empty state', () => {
    const html = renderToStaticMarkup(<EmptyNote action={{ label: 'Open my work', href: '/my-work' }}>You are all caught up.</EmptyNote>);
    expect(html).toContain('href="/my-work"');
  });

  it('can make the next step a button when it opens on this page', () => {
    const element = EmptyNote({ action: { label: 'Add a step', onClick: () => undefined }, children: 'No steps yet.' });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<button type="button" class="ks-dash-section-action ks-dash-button">Add a step');
    expect(html).not.toContain('<a');
    const button = findElement(element, (node) => node.type === 'button');
    let clicked = 0;
    const onClick = () => {
      clicked += 1;
    };
    const wired = findElement(EmptyNote({ action: { label: 'Add a step', onClick }, children: 'x' }), (node) => node.type === 'button');
    expect(button).toBeTruthy();
    (wired?.props as { onClick: () => void }).onClick();
    expect(clicked).toBe(1);
  });

  it('shows a count next to the section title and hides it at zero', () => {
    const counted = renderToStaticMarkup(
      <DashSection title="Overdue" count={3} countTone="critical">
        <p>body</p>
      </DashSection>,
    );
    expect(counted).toMatch(/<h2[^>]*>Overdue<span class="ks-dash-count" data-tone="critical">3<\/span><\/h2>/);
    const empty = renderToStaticMarkup(
      <DashSection title="Overdue" count={0}>
        <p>body</p>
      </DashSection>,
    );
    expect(empty).not.toContain('ks-dash-count');
  });

  it('keeps the count neutral unless told otherwise, and puts help in a tooltip', () => {
    const html = renderToStaticMarkup(
      <DashSection title="Open jobs" count={12} help="Jobs with work logged this month">
        <p>body</p>
      </DashSection>,
    );
    expect(html).toContain('data-tone="neutral">12</span>');
    expect(html).toContain('title="Jobs with work logged this month"');
    expect(html).not.toContain('<svg aria-hidden="true" viewBox="0 0 16 16" class="ks-dash-info');
  });
});

describe('Legend toggles', () => {
  const items = [
    { label: 'Open', color: 'var(--chart-1)' },
    { label: 'Closed', color: 'var(--chart-2)', hidden: true },
  ];

  it('stays plain text without onToggle', () => {
    expect(renderToStaticMarkup(<Legend items={items} />)).not.toContain('<button');
  });

  it('turns each entry into a pressed or unpressed toggle', () => {
    const html = renderToStaticMarkup(<Legend items={items} onToggle={() => undefined} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-hidden=""');
    expect(html).not.toContain('ks-dash-pill');
  });

  it('reports which series was toggled', () => {
    const seen: string[] = [];
    const element = Legend({ items, onToggle: (label) => seen.push(label) });
    const buttons = findAll(element, (node) => node.type === 'button');
    expect(buttons).toHaveLength(2);
    (buttons[1]?.props as { onClick: () => void }).onClick();
    expect(seen).toEqual(['Closed']);
  });
});

describe('Meter size', () => {
  it('is thin by default and thick when asked, in the same data color', () => {
    expect(renderToStaticMarkup(<Meter value={0.5} label="Picked" />)).toContain('data-size="thin"');
    expect(renderToStaticMarkup(<Meter value={0.5} label="Picked" size="thick" />)).toContain('data-size="thick"');
    expect(rule(".ks-dash-meter[data-size='thick']")).toMatch(/height: 8px;/);
  });
});

type AnyElement = React.ReactElement<{ children?: React.ReactNode; onClick?: () => void }>;

function findAll(node: React.ReactNode, match: (element: AnyElement) => boolean): AnyElement[] {
  if (!React.isValidElement(node)) {
    return Array.isArray(node) ? node.flatMap((child) => findAll(child, match)) : [];
  }
  const element = node as AnyElement;
  const own = match(element) ? [element] : [];
  return [...own, ...React.Children.toArray(element.props.children).flatMap((child) => findAll(child, match))];
}

function findElement(node: React.ReactNode, match: (element: AnyElement) => boolean): AnyElement | undefined {
  return findAll(node, match)[0];
}

describe('frame and links', () => {
  it('sets the app feel on the frame', () => {
    const html = renderToStaticMarkup(
      <DashboardFrame app="wms">
        <DashboardHeader title="Dashboard" subtitle="Day shift" />
      </DashboardFrame>,
    );
    expect(html).toContain('data-app="wms"');
    expect(html).toContain('<h1 class="ks-dash-title">Dashboard</h1>');
  });

  it('uses the app link component when one is provided', () => {
    function AppLink({ href, children, className }: DashLinkProps) {
      return (
        <a href={href} className={className} data-app-link="">
          {children}
        </a>
      );
    }
    const html = renderToStaticMarkup(
      <DashboardLinkProvider component={AppLink}>
        <StatTile label="Revenue" value="$1" href="/r" />
      </DashboardLinkProvider>,
    );
    expect(html).toContain('data-app-link=""');
  });
});
