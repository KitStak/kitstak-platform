'use client';
/**
 * Direction-aware step transition: 20px slide + fade over 250ms (enter curve). When the user
 * prefers reduced motion the step swaps with a plain CSS fade and motion is not mounted at all
 * (so it never logs its reduced-motion warning) (G-6).
 */
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const ENTER: [number, number, number, number] = [0, 0, 0.35, 1];
const EXIT: [number, number, number, number] = [0.4, 0, 1, 1];

export function StepTransition({
  stepKey,
  direction,
  children,
  className,
}: {
  readonly stepKey: string;
  /** 1 = forward, -1 = back. */
  readonly direction: 1 | -1;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <div key={stepKey} className={['animate-fade-in', className].filter(Boolean).join(' ')}>
        {children}
      </div>
    );
  }
  const offset = 20 * direction;
  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={stepKey}
        className={className}
        initial={{ opacity: 0, x: offset }}
        animate={{ opacity: 1, x: 0, transition: { duration: 0.25, ease: ENTER } }}
        exit={{ opacity: 0, x: -offset, transition: { duration: 0.15, ease: EXIT } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
