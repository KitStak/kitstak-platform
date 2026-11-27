import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShellLoader } from '@/components/layout/shell-loader';
import { ShellSkeleton } from '@/components/layout/shell-skeleton';
import { SETUP_LOADERS, SETUP_MESSAGES } from '@/lib/warehouse-setup-loader-model';

describe('ShellLoader', () => {
  const html = renderToStaticMarkup(<ShellLoader />);

  it('takes turns through every app loader and every warehouse chore', () => {
    expect(html.match(/class="ks-shell-icon /g)).toHaveLength(SETUP_LOADERS.length);
    expect(html.match(/class="ks-shell-msg /g)).toHaveLength(SETUP_MESSAGES.length);
    for (const loader of SETUP_LOADERS) expect(html).toContain(`src="${loader.src}"`);
    expect(html).toContain('Opening your warehouse');
  });

  it('staggers the turns 4 s apart after the appear delay', () => {
    expect(html).toContain('animation-delay:0.8s');
    expect(html).toContain('animation-delay:4.8s');
    expect(html).toContain(`ks-shell-msg ${SETUP_MESSAGES.length * 4}s`);
  });

  it('animates in CSS only and holds still for reduced motion', () => {
    expect(html).not.toContain('<script');
    expect(html).toContain('prefers-reduced-motion');
  });
});

describe('ShellSkeleton', () => {
  it('shows the loader and keeps the slow-load notice', () => {
    const html = renderToStaticMarkup(<ShellSkeleton />);
    expect(html).toContain('data-testid="shell-loader"');
    expect(html).toContain('data-testid="slow-load-notice"');
  });
});
