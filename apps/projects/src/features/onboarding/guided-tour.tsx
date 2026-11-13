'use client';
/**
 * Four-step guided tour with a spotlight: the page dims except the thing being explained, and a
 * card next to it says what it does in one or two sentences. Arrow keys / Enter move, Esc skips.
 * Steps whose target isn't on screen (e.g. the sidebar on a phone) show the card in the middle.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button, IconButton, Kbd, cn, useModKey } from '@/components/ui';

export interface TourStep {
  readonly id: string;
  /** CSS selector of the element to spotlight. */
  readonly target: string;
  /** Used when `target` isn't on screen (e.g. the sidebar on a phone lives behind the menu button). */
  readonly fallbackTarget?: string;
  /** Extra sentence shown when the fallback is used. */
  readonly fallbackHint?: string;
  readonly title: string;
  readonly body: React.ReactNode;
  /** Where the card goes relative to the target. */
  readonly placement: 'right' | 'bottom';
}

export function useTourSteps(): readonly TourStep[] {
  const mod = useModKey();
  return useMemo(() => buildSteps(mod), [mod]);
}

function buildSteps(mod: string): readonly TourStep[] {
  return [
    {
      id: 'projects',
      target: '[data-testid="nav-projects"]',
      fallbackTarget: '[aria-label="Open navigation"]',
      fallbackHint: 'On a phone, tap the menu button to find them.',
      title: 'Your projects live here',
      body: 'Every project has a board, a list, a timeline and a calendar. Group projects into spaces like “Operations” or “Marketing”.',
      placement: 'right',
    },
    {
      id: 'new-task',
      target: '[data-testid="topbar-quick-add"]',
      title: 'Add a task from anywhere',
      body: (
        <>
          Press <Kbd>C</Kbd> on any page and just type, like “Call Acme tomorrow !high @maya”. Dates, priority
          and people are picked up for you.
        </>
      ),
      placement: 'bottom',
    },
    {
      id: 'search',
      target: '[data-testid="topbar-search"]',
      title: 'Find anything fast',
      body: (
        <>
          Press <Kbd>{mod}</Kbd> <Kbd>K</Kbd> to search tasks, projects and people, or to jump anywhere
          without the mouse.
        </>
      ),
      placement: 'bottom',
    },
    {
      id: 'my-work',
      target: '[data-testid="nav-my-work"]',
      fallbackTarget: '[aria-label="Open navigation"]',
      fallbackHint: 'On a phone, it’s in the menu.',
      title: 'Your to-do list, all in one place',
      body: 'My work shows everything assigned to you across every project, sorted by when it’s due. Start your day here.',
      placement: 'right',
    },
  ];
}

interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

const PAD = 6;
const CARD_WIDTH = 340;

function findTarget(selector: string): HTMLElement | null {
  const list = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return (
    list.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }) ?? null
  );
}

export function GuidedTour({
  open,
  step,
  onStep,
  onClose,
}: {
  readonly open: boolean;
  readonly step: number;
  readonly onStep: (step: number) => void;
  /** `finished` true when the last step was completed (not skipped). */
  readonly onClose: (finished: boolean) => void;
}) {
  const steps = useTourSteps();
  const current = steps[Math.min(step, steps.length - 1)];
  const [rect, setRect] = useState<Rect | null>(null);
  const [fallback, setFallback] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const last = step >= steps.length - 1;

  const measure = useCallback(() => {
    setViewport((prev) =>
      prev.width === window.innerWidth && prev.height === window.innerHeight
        ? prev
        : { width: window.innerWidth, height: window.innerHeight },
    );
    let el = current ? findTarget(current.target) : null;
    const usedFallback = !el && Boolean(current?.fallbackTarget);
    if (!el && current?.fallbackTarget) el = findTarget(current.fallbackTarget);
    setFallback(usedFallback && Boolean(el));
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const next = {
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    };
    setRect((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    );
  }, [current]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(measure);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const timer = window.setInterval(measure, 500);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearInterval(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [open, measure]);

  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose(false);
      } else if (
        event.key === 'ArrowRight' ||
        (event.key === 'Enter' && document.activeElement === cardRef.current)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (last) onClose(true);
        else onStep(step + 1);
      } else if (event.key === 'ArrowLeft' && step > 0) {
        event.preventDefault();
        event.stopPropagation();
        onStep(step - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, step, last, onStep, onClose]);

  if (!open || !current || typeof document === 'undefined') return null;

  const narrow = viewport.width < 640;
  let cardStyle: React.CSSProperties;
  if (!rect || narrow) {
    cardStyle =
      rect && narrow
        ? { left: 16, right: 16, top: Math.min(rect.top + rect.height + 12, viewport.height - 260) }
        : {
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: `min(${CARD_WIDTH}px, calc(100vw - 32px))`,
          };
  } else if (current.placement === 'right') {
    cardStyle = {
      left: rect.left + rect.width + 14,
      top: Math.max(16, Math.min(rect.top - 8, viewport.height - 240)),
      width: CARD_WIDTH,
    };
  } else {
    const left = Math.max(
      16,
      Math.min(rect.left + rect.width / 2 - CARD_WIDTH / 2, viewport.width - CARD_WIDTH - 16),
    );
    cardStyle = { left, top: rect.top + rect.height + 14, width: CARD_WIDTH };
  }

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-toast)]" data-testid="guided-tour">
      {/* Click-blocker + dim. The spotlight is a transparent box with a huge shadow around it. */}
      <div
        className="absolute inset-0"
        onClick={() => onClose(false)}
        aria-hidden
        style={rect ? undefined : { background: 'var(--surface-overlay, rgba(10,22,40,0.55))' }}
      />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(10, 22, 40, 0.55)',
          }}
        />
      ) : null}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className={cn(
          'absolute rounded-xl border border-border-subtle bg-raised p-4 text-fg shadow-modal outline-none animate-pop-in',
        )}
        style={cardStyle}
        data-testid="tour-card"
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 text-xs font-semibold tracking-wide text-primary-text uppercase">
            Step {step + 1} of {steps.length}
          </p>
          <IconButton
            size="sm"
            label="Skip the tour"
            icon={<X aria-hidden />}
            onClick={() => onClose(false)}
            className="-mt-1 -mr-1"
          />
        </div>
        <h2 id="tour-title" className="mt-1 text-md font-semibold text-fg">
          {current.title}
        </h2>
        <p id="tour-body" className="mt-1 text-sm text-fg-secondary">
          {current.body}
          {fallback && current.fallbackHint ? ` ${current.fallbackHint}` : null}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1" aria-hidden>
            {steps.map((s, index) => (
              <span
                key={s.id}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  index === step ? 'w-5 bg-primary' : 'w-1.5 bg-border-strong',
                )}
              />
            ))}
          </div>
          {step > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<ArrowLeft aria-hidden />}
              onClick={() => onStep(step - 1)}
            >
              Back
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => onClose(false)}>
              Skip
            </Button>
          )}
          <Button
            size="sm"
            trailingIcon={last ? undefined : <ArrowRight aria-hidden />}
            onClick={() => (last ? onClose(true) : onStep(step + 1))}
            data-testid="tour-next"
          >
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
