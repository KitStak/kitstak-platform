import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PriorityIcon } from './priority-icon';

const fills = (html: string) => [...html.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);

describe('PriorityIcon', () => {
  it('draws high, medium and low bars in neutral ink, the bar count says the level', () => {
    expect(fills(renderToStaticMarkup(<PriorityIcon priority="high" />))).toEqual(['var(--icon-default)', 'var(--icon-default)', 'var(--icon-default)']);
    expect(fills(renderToStaticMarkup(<PriorityIcon priority="medium" />))).toEqual(['var(--icon-default)', 'var(--icon-default)', 'var(--border-strong)']);
    expect(fills(renderToStaticMarkup(<PriorityIcon priority="low" />))).toEqual(['var(--icon-default)', 'var(--border-strong)', 'var(--border-strong)']);
  });

  it('keeps the danger square only for urgent', () => {
    expect(renderToStaticMarkup(<PriorityIcon priority="urgent" />)).toContain('fill="var(--danger)"');
    for (const priority of ['high', 'medium', 'low', 'none'] as const) {
      expect(renderToStaticMarkup(<PriorityIcon priority={priority} />)).not.toMatch(/--danger|--label-|--primary/);
    }
  });

  it('names the level for screen readers', () => {
    expect(renderToStaticMarkup(<PriorityIcon priority="medium" />)).toContain('aria-label="Medium"');
  });
});
