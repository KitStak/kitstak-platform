import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AppIcon } from './app-icon';
import type { AppIconId } from './app-icon';

const render = (app: AppIconId, size?: number): string => renderToStaticMarkup(createElement(AppIcon, { app, size }));
const rectCount = (markup: string): number => markup.match(/<rect /g)?.length ?? 0;

describe('AppIcon', () => {
  test.each<[AppIconId, number]>([
    ['portal', 4],
    ['crm', 3],
    ['wms', 8],
    ['projects', 3],
  ])('draws the %s icon with the same number of shapes as the brand file', (app, shapes) => {
    expect(rectCount(render(app))).toBe(shapes);
  });

  test('keeps the brand artboard and scales to the requested size', () => {
    const markup = render('crm', 40);

    expect(markup).toContain('viewBox="0 0 200 200"');
    expect(markup).toContain('width="40"');
    expect(markup).toContain('height="40"');
  });

  test('applies the warehouse file offset only to the WMS icon', () => {
    expect(render('wms')).toContain('translate(0,-8)');
    expect(render('crm')).not.toContain('translate');
  });

  test('is hidden from assistive tech, since the app name is written beside it', () => {
    expect(render('portal')).toContain('aria-hidden="true"');
  });

  test('uses only the two brand colours', () => {
    const fills = new Set([...render('wms').matchAll(/fill="([^"]+)"/g)].map((match) => match[1]));

    expect([...fills].sort()).toEqual(['#C8102E', '#D65A6E']);
  });
});
