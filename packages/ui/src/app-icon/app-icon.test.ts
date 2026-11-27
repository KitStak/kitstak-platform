import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AppIcon } from './app-icon';
import type { AppIconId } from './app-icon';

const render = (app: AppIconId, size?: number): string => renderToStaticMarkup(createElement(AppIcon, { app, size }));
const shapeCount = (markup: string): number => markup.match(/<(rect|polygon) /g)?.length ?? 0;

describe('AppIcon', () => {
  test.each<[AppIconId, number]>([
    ['portal', 4],
    ['crm', 3],
    ['wms', 8],
    ['projects', 3],
    ['pulse', 2],
  ])('draws the %s icon with the same number of shapes as the brand file', (app, shapes) => {
    expect(shapeCount(render(app))).toBe(shapes);
  });

  test('draws the Pulse icon as the two notched bars from the brand file', () => {
    const markup = render('pulse');

    expect(markup).toContain('points="40,71 82,71 100,53 118,71 160,71 160,101 118,101 100,83 82,101 40,101" fill="#C8102E"');
    expect(markup).toContain('points="40,117 82,117 100,99 118,117 160,117 160,147 118,147 100,129 82,147 40,147" fill="#D65A6E"');
    expect(markup).not.toContain('<rect ');
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
