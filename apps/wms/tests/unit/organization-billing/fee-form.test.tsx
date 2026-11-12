// @vitest-environment jsdom
/** Regression (critic R2 blocker): Create fee must render with no operation selected and open the condition modal once one is picked. */
import '../foundation-f4b/dom-shims';
import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/billing/c1',
  useSearchParams: () => new URLSearchParams(),
}));

import { QueryProvider } from '@/lib/query-client';
import { FeeForm } from '@/components/billing/fee-form';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryProvider client={client}>{ui}</QueryProvider>);
}

describe('FeeForm in create mode', () => {
  it('renders without an operation, then opens Add condition for the picked operation', async () => {
    const user = userEvent.setup();
    wrap(<FeeForm contractId="c1" fee={null} onDone={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Create fee' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add condition/ })).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Shipment/ }));
    await user.click(screen.getByRole('button', { name: /Add condition/ }));
    expect(await screen.findByText(/only charges shipment activity/)).toBeTruthy();
  });
});
