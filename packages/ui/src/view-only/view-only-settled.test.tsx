// @vitest-environment jsdom
/**
 * The view only mark waits until React has COMMITTED an element (docs/billing/SPEC.md section 9.4).
 * React attaches itself to server HTML while it is still hydrating. That work can be thrown away and
 * done again, and an attribute added in between is a hydration error in the console. These tests
 * hydrate a real page with a part that waits, and prove the guard only calls an element settled once
 * its part of the page is committed.
 */
import * as React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSettled } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('isSettled', () => {
  it('is false for server HTML that React has not touched', () => {
    document.body.innerHTML = '<div id="root"><a href="/clients/new">Add client</a></div>';
    expect(isSettled(document.querySelector('a')!)).toBe(false);
  });

  it('is false while a part of the page still hydrates, and true once it is committed', async () => {
    // The inner part waits for "code" on the browser, the way a streamed part of a real page does.
    let arrive: () => void = () => undefined;
    let waiting: Promise<void> | null = null;
    let ready = true;
    function Late(): React.JSX.Element {
      if (!ready) {
        waiting ??= new Promise<void>((resolve) => {
          arrive = () => {
            ready = true;
            resolve();
          };
        });
        throw waiting;
      }
      return <p>Three clients</p>;
    }
    function Page(): React.JSX.Element {
      return (
        <main>
          <button type="button">Create warehouse</button>
          <React.Suspense fallback={<p>Loading</p>}>
            <section>
              {/* React reaches the link first, then the part that waits, and throws the work away. */}
              <a href="/clients/new">Add client</a>
              <Late />
            </section>
          </React.Suspense>
        </main>
      );
    }

    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(<Page />);
    const outer = container.querySelector('button')!;
    const inner = container.querySelector('a')!;
    expect(inner.textContent).toBe('Add client');

    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ready = false;
    let root: ReturnType<typeof hydrateRoot> | null = null;
    await React.act(async () => {
      root = hydrateRoot(container, <Page />);
    });
    // The shell is committed. React has attached itself to the link, but that work was thrown away:
    // the link is still server HTML that React will compare again.
    expect(isSettled(outer)).toBe(true);
    expect(Object.keys(inner).some((key) => key.startsWith('__reactFiber$'))).toBe(true);
    expect(isSettled(inner)).toBe(false);

    await React.act(async () => {
      arrive();
      await waiting;
    });
    expect(isSettled(inner)).toBe(true);
    // A mark put on now is never compared again.
    inner.setAttribute('data-plan-write', '');
    await React.act(async () => {
      root!.render(<Page />);
    });
    expect(errors).not.toHaveBeenCalled();
    await React.act(async () => {
      root!.unmount();
    });
  });

  it('is true for an element React made in the browser', async () => {
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(<button type="button">Create client</button>);
    });
    expect(isSettled(container.querySelector('button')!)).toBe(true);
    await React.act(async () => {
      root.unmount();
    });
  });
});
