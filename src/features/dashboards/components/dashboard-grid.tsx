'use client';

/**
 * Draggable + resizable widget grid. Drag by the widget header, resize from the bottom-right
 * grip, or use the keyboard on a focused header (arrows move, Shift+arrows resize).
 *
 * Responsive columns: 12 columns from 640px of grid width, a 6-column remap for narrower grids
 * (still editable; edits are saved back in 12-column geometry), and a read-only single column
 * on phone viewports.
 *
 * Performance: the pointer interaction lives in refs. The dragged widget is moved by writing its
 * transform directly, the reflow preview is recomputed at most once per animation frame and
 * only when the target cell changes, and every slot is memoised with stable callbacks so widget
 * bodies (charts, tables) never re-render during a drag.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { DashboardWidgetDto } from '@/server/services/contracts/dto';
import { widgetKindOf } from '@/server/services/contracts/dashboard-insights';
import { widgetDefinition } from '../lib/catalog';
import {
  GRID_GAP,
  ROW_HEIGHT,
  changedItems,
  columnsFor,
  layoutHeight,
  moveItem,
  remapLayout,
  resizeItem,
  toCell,
  toFullColumns,
  toPixels,
  toSpan,
  type GridItem,
} from '../lib/layout';
import { useElementSize } from '../widgets/use-element-size';

const DRAG_THRESHOLD = 4;

type Box = { left: number; top: number; width: number; height: number };

interface Interaction {
  readonly id: string;
  readonly mode: 'move' | 'resize';
  readonly startX: number;
  readonly startY: number;
  readonly origin: Box;
  started: boolean;
  lastKey: string;
  frame: number | null;
  dx: number;
  dy: number;
}

export interface GridSlotProps {
  readonly dragging: boolean;
  readonly handleProps?: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    tabIndex: number;
    'aria-roledescription': string;
    'aria-describedby': string;
  };
  readonly onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface DashboardGridProps {
  readonly widgets: readonly DashboardWidgetDto[];
  readonly canMove: boolean;
  readonly onCommit: (changes: GridItem[]) => void;
  /** Must be referentially stable (useCallback) so slots can skip re-rendering. */
  readonly renderWidget: (widget: DashboardWidgetDto, slot: GridSlotProps) => ReactNode;
}

function toGrid(widget: DashboardWidgetDto): GridItem {
  return { id: widget.id, x: widget.x, y: widget.y, w: widget.w, h: widget.h };
}

function limitsOf(widget: DashboardWidgetDto | undefined, cols: number) {
  const limits = widget ? widgetDefinition(widgetKindOf(widget.type, widget.config)).limits : { minW: 1, minH: 1 };
  return cols >= 12 ? limits : { ...limits, minW: Math.max(1, Math.ceil(limits.minW / (12 / cols))) };
}

function boxStyle(box: Box) {
  return { transform: `translate(${box.left}px, ${box.top}px)`, width: box.width, height: box.height, left: 0, top: 0 };
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

interface SlotProps {
  readonly widget: DashboardWidgetDto;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly active: boolean;
  readonly canMove: boolean;
  readonly begin: (id: string, mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => void;
  readonly onKey: (id: string, event: KeyboardEvent<HTMLElement>) => void;
  readonly register: (id: string, node: HTMLDivElement | null) => void;
  readonly renderWidget: DashboardGridProps['renderWidget'];
}

const GridSlot = memo(function GridSlot({
  widget,
  left,
  top,
  width,
  height,
  x,
  y,
  w,
  h,
  active,
  canMove,
  begin,
  onKey,
  register,
  renderWidget,
}: SlotProps) {
  const id = widget.id;
  const title = widget.title;
  const handleProps = useMemo<GridSlotProps['handleProps']>(
    () =>
      canMove
        ? {
            onPointerDown: (event) => begin(id, 'move', event),
            onKeyDown: (event) => onKey(id, event),
            tabIndex: 0,
            // A group (not a button: the header holds its own buttons) with a short name.
            role: 'group',
            'aria-label': title,
            'aria-roledescription': 'draggable widget',
            'aria-describedby': 'dashboard-grid-help',
          }
        : undefined,
    [begin, canMove, id, onKey, title],
  );
  const onResizeStart = useMemo(
    () => (canMove ? (event: ReactPointerEvent<HTMLElement>) => begin(id, 'resize', event) : undefined),
    [begin, canMove, id],
  );
  const slot = useMemo<GridSlotProps>(() => ({ dragging: active, handleProps, onResizeStart }), [active, handleProps, onResizeStart]);
  const content = useMemo(() => renderWidget(widget, slot), [renderWidget, widget, slot]);
  const ref = useCallback((node: HTMLDivElement | null) => register(id, node), [id, register]);
  return (
    <div
      ref={ref}
      className={
        active
          ? 'absolute z-20 will-change-transform'
          : 'absolute z-[1] transition-[transform,width,height] duration-[var(--duration-normal)] ease-out motion-reduce:transition-none'
      }
      style={boxStyle({ left, top, width, height })}
      data-grid-x={x}
      data-grid-y={y}
      data-grid-w={w}
      data-grid-h={h}
    >
      {content}
    </div>
  );
});

export function DashboardGrid({ widgets, canMove, onCommit, renderWidget }: DashboardGridProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const viewport = useViewportWidth();
  const width = size.width;
  const cols = columnsFor(width, viewport);
  const editable = canMove && cols >= 6;
  const base = useMemo(() => remapLayout(widgets.map(toGrid), cols === 1 ? 12 : cols), [widgets, cols]);
  const byId = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget])), [widgets]);
  const [preview, setPreview] = useState<GridItem[] | null>(null);
  const [active, setActive] = useState<{ id: string; mode: 'move' | 'resize'; origin: Box } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const interaction = useRef<Interaction | null>(null);
  const previewRef = useRef<GridItem[] | null>(null);
  const awaitingBase = useRef(false);
  const released = useRef<string | null>(null);
  const listeners = useRef<(() => void) | null>(null);
  const latest = useRef({ base, width, cols, byId, onCommit, editable });
  useLayoutEffect(() => {
    latest.current = { base, width, cols, byId, onCommit, editable };
  });
  const layout = preview ?? base;

  // The released widget's node still carries the drag transform written by the pointer handler;
  // write its slot geometry now that it has its transition class again, so it glides into place.
  useLayoutEffect(() => {
    const id = released.current;
    if (!id || active) return;
    released.current = null;
    const node = nodes.current.get(id);
    const item = layout.find((entry) => entry.id === id);
    if (!node || !item || width <= 0) return;
    const box = toPixels(item, width, cols);
    node.style.transform = `translate(${box.left}px, ${box.top}px)`;
    node.style.width = `${box.width}px`;
    node.style.height = `${box.height}px`;
  });

  const register = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  /** Saves the changed items; returns whether anything changed. */
  const commit = useCallback((next: GridItem[]) => {
    const { base: current, cols: columns, onCommit: save } = latest.current;
    const changes = changedItems(current, next);
    if (changes.length > 0) save(toFullColumns(changes, columns));
    return changes.length > 0;
  }, []);

  const finish = useCallback(
    (shouldCommit: boolean) => {
      const state = interaction.current;
      listeners.current?.();
      listeners.current = null;
      interaction.current = null;
      if (!state) return;
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      const next = previewRef.current;
      previewRef.current = null;
      const saved = shouldCommit && state.started && next ? commit(next) : false;
      // Keep the committed preview on screen until the optimistic layout arrives (no snap-back).
      awaitingBase.current = saved;
      if (!saved) setPreview(null);
      released.current = state.started ? state.id : null;
      setActive(null);
    },
    [commit],
  );

  // A new base layout (optimistic save, rollback or server data) replaces a settled preview.
  useEffect(() => {
    if (!awaitingBase.current) return;
    awaitingBase.current = false;
    setPreview(null);
  }, [base]);

  const recompute = useCallback(() => {
    const state = interaction.current;
    if (!state) return;
    state.frame = null;
    const { base: current, width: gridWidth, cols: columns, byId: widgetsById } = latest.current;
    const item = current.find((entry) => entry.id === state.id);
    if (!item) return;
    let key: string;
    let next: GridItem[];
    if (state.mode === 'move') {
      const cell = toCell(state.origin.left + state.dx, state.origin.top + state.dy, gridWidth, columns);
      key = `${cell.x}:${cell.y}`;
      if (key === state.lastKey) return;
      next = moveItem(current, state.id, cell.x, cell.y, columns);
    } else {
      const span = toSpan(state.origin.width + state.dx, state.origin.height + state.dy, gridWidth, columns);
      key = `${span.w}:${span.h}`;
      if (key === state.lastKey) return;
      next = resizeItem(current, state.id, Math.min(span.w, columns - item.x), span.h, limitsOf(widgetsById.get(state.id), columns), columns);
    }
    state.lastKey = key;
    previewRef.current = next;
    setPreview(next);
  }, []);

  const begin = useCallback(
    (id: string, mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => {
      const { editable: canEdit, base: current, width: gridWidth, cols: columns } = latest.current;
      if (event.button !== 0 || !canEdit || interaction.current) return;
      const target = event.target as HTMLElement;
      if (mode === 'move' && target.closest('button, input, textarea, a, [role="menuitem"]')) return;
      const item = current.find((entry) => entry.id === id);
      if (!item) return;
      if (mode === 'resize') event.preventDefault();
      event.stopPropagation();
      const origin = toPixels(item, gridWidth, columns);
      interaction.current = {
        id,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin,
        started: false,
        lastKey: '',
        frame: null,
        dx: 0,
        dy: 0,
      };
      const onMove = (move: PointerEvent) => {
        const state = interaction.current;
        if (!state) return;
        state.dx = move.clientX - state.startX;
        state.dy = move.clientY - state.startY;
        if (!state.started) {
          if (Math.hypot(state.dx, state.dy) < DRAG_THRESHOLD) return;
          state.started = true;
          setActive({ id: state.id, mode: state.mode, origin: state.origin });
        }
        const node = nodes.current.get(state.id);
        if (node) {
          if (state.mode === 'move') {
            node.style.transform = `translate(${state.origin.left + state.dx}px, ${state.origin.top + state.dy}px)`;
          } else {
            node.style.width = `${Math.max(state.origin.width + state.dx, 120)}px`;
            node.style.height = `${Math.max(state.origin.height + state.dy, 80)}px`;
          }
        }
        if (state.frame === null) state.frame = requestAnimationFrame(recompute);
      };
      const onUp = () => finish(true);
      const onKey = (key: globalThis.KeyboardEvent) => {
        if (key.key === 'Escape') finish(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('keydown', onKey);
      listeners.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKey);
      };
    },
    [finish, recompute],
  );

  useEffect(() => () => listeners.current?.(), []);

  const onKey = useCallback(
    (id: string, event: KeyboardEvent<HTMLElement>) => {
      const { editable: canEdit, base: current, cols: columns, byId: widgetsById } = latest.current;
      if (event.target !== event.currentTarget || !canEdit) return;
      const deltas: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const delta = deltas[event.key];
      const item = current.find((entry) => entry.id === id);
      if (!delta || !item) return;
      event.preventDefault();
      const next = event.shiftKey
        ? resizeItem(current, id, item.w + delta[0], item.h + delta[1], limitsOf(widgetsById.get(id), columns), columns)
        : moveItem(current, id, item.x + delta[0], item.y + delta[1] * (delta[1] > 0 ? item.h : 1), columns);
      commit(next);
      const moved = next.find((entry) => entry.id === id);
      if (moved) {
        setAnnouncement(
          event.shiftKey ? `Resized to ${moved.w} columns by ${moved.h} rows` : `Moved to column ${moved.x + 1}, row ${moved.y + 1}`,
        );
      }
    },
    [commit],
  );

  if (cols === 1) {
    const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
    return (
      <div ref={containerRef} className="flex flex-col gap-3" data-testid="dashboard-grid" data-layout="stacked" data-columns={1}>
        {ordered.map((widget) => {
          const kind = widgetKindOf(widget.type, widget.config);
          const chromeless = widgetDefinition(kind).chromeless;
          const rows = Math.min(widget.h, 10);
          const height = chromeless ? 64 : Math.max(rows * ROW_HEIGHT + (rows - 1) * 12, kind === 'numbers' ? 168 : 240);
          return (
            <div key={widget.id} style={{ height }} data-widget-slot={widget.id}>
              {renderWidget(widget, { dragging: false })}
            </div>
          );
        })}
      </div>
    );
  }

  const rows = layoutHeight(layout) + (active ? 2 : 0);
  const height = Math.max(rows * (ROW_HEIGHT + GRID_GAP) - GRID_GAP, 0);
  const placeholder = active ? layout.find((item) => item.id === active.id) : undefined;

  return (
    <div
      ref={containerRef}
      className="relative w-full select-none"
      style={{ height: width > 0 ? height : undefined, minHeight: width > 0 ? undefined : 320 }}
      data-testid="dashboard-grid"
      data-layout="grid"
      data-columns={cols}
      data-dragging={active ? 'true' : undefined}
    >
      <p id="dashboard-grid-help" className="sr-only">
        {editable ? 'Drag the widget header to move it. With the header focused, use arrow keys to move and Shift with arrow keys to resize.' : ''}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {placeholder && width > 0 ? (
        <div
          aria-hidden
          className="absolute z-[2] rounded-lg border-2 border-dashed border-primary bg-primary-subtle/70 transition-[transform,width,height] duration-[var(--duration-fast)] ease-out motion-reduce:transition-none"
          data-testid="grid-drop-placeholder"
          style={boxStyle(toPixels(placeholder, width, cols))}
        />
      ) : null}
      {width > 0
        ? layout.map((item) => {
            const widget = byId.get(item.id);
            if (!widget) return null;
            const isActive = active?.id === item.id;
            // While dragging, the active slot keeps its origin geometry in React; the pointer
            // handler moves the DOM node directly.
            const box = isActive ? active.origin : toPixels(item, width, cols);
            return (
              <GridSlot
                key={item.id}
                widget={widget}
                left={box.left}
                top={box.top}
                width={box.width}
                height={box.height}
                x={item.x}
                y={item.y}
                w={item.w}
                h={item.h}
                active={isActive}
                canMove={editable}
                begin={begin}
                onKey={onKey}
                register={register}
                renderWidget={renderWidget}
              />
            );
          })
        : null}
    </div>
  );
}
