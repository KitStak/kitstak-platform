import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { AppIconId } from '../app-icon/app-icon';
import { Logo } from './logo';
import type { LogoProps } from './logo';

const render = (props: LogoProps = {}): string => renderToStaticMarkup(createElement(Logo, props));
const lockupWidth = (markup: string): number => Number(markup.match(/style="width:([\d.]+)px;height:/)?.[1]);

describe('Logo', () => {
  test('draws the two KitStak bars when no app is given', () => {
    const markup = render();

    expect(markup.match(/<rect /g)).toHaveLength(2);
    expect(markup).toContain('fill="var(--brand-red)"');
    expect(markup).not.toContain('<polygon ');
  });

  test('draws the Pulse icon in place of the bars for the Pulse lockup', () => {
    const markup = render({ app: 'pulse', product: 'Pulse' });

    expect(markup.match(/<polygon /g)).toHaveLength(2);
    expect(markup).not.toContain('var(--brand-red)');
    expect(markup).toContain('>Pulse</span>');
  });

  test.each<AppIconId>(['portal', 'crm', 'wms', 'projects'])('draws the %s icon in place of the bars', (app) => {
    const markup = render({ app });

    expect(markup).not.toContain('var(--brand-red)');
    expect(markup).toContain('viewBox="34 50 132 100"');
  });

  test('keeps the wordtype the same height and leaves room for the wider icon', () => {
    const bars = render({ size: 30 });
    const app = render({ size: 30, app: 'crm' });

    expect(lockupWidth(app)).toBeGreaterThan(lockupWidth(bars));
    expect(app).toContain('height:24px');
    expect(bars).toContain('height:24px');
  });

  test('keeps the KitStak name for assistive tech', () => {
    expect(render({ app: 'wms' })).toContain('aria-label="KitStak"');
  });
});
