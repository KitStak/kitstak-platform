'use client';
import { useEffect, useRef } from 'react';
import type { CellRenderContext } from '../cell-context';

/**
 * Register the editor's "commit my draft" function so Tab can save it before moving to the
 * next cell. `flush` returns false when the draft is invalid (the editor then stays open).
 */
export function useTabFlush(ctx: Pick<CellRenderContext, 'registerFlush'>, flush: () => boolean): void {
  const latest = useRef(flush);
  useEffect(() => {
    latest.current = flush;
  });
  const register = ctx.registerFlush;
  useEffect(() => {
    if (!register) return undefined;
    register(() => latest.current());
    return () => register(null);
  }, [register]);
}
