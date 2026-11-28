import type { AppId } from '../app-icon';
import { ShotPlaceholder } from './shot-placeholder';
import styles from '../pulse/pulse-shot.module.css';

/**
 * One screenshot slot on a Crew or Ledger page. While `file` is null the page shows a labelled
 * placeholder. Fill `file` with a real screenshot and the slot shows it instead, with no other
 * change. A slot with no file blocks that app's go-live switch (src/lib/go-live.test.ts).
 */
export interface AppShotSlot {
  /** The screen's name, shown in the caption: "Weekly schedule". */
  readonly screen: string;
  /** One line on what the screen shows. */
  readonly note: string;
  /**
   * The real screenshot, a path under public: `/crew/shots/schedule.webp`. Null until it is taken.
   * Capture a real screen of the running app with demo data, light theme, 1440 wide at 2x, then
   * crop and compress to WebP under 200 KB.
   */
  readonly file: string | null;
  /** Pixel size of `file`, so the page does not shift while it loads. Required with a file. */
  readonly width?: number;
  readonly height?: number;
  /** What the real picture shows, for screen readers. Required with a file. */
  readonly alt?: string;
  /** Placeholder only: how many grey rows to draw, and its shape. */
  readonly rows?: number;
  readonly shape?: 'wide' | 'narrow';
}

interface AppShotProps {
  readonly app: AppId;
  readonly product: string;
  readonly slot: AppShotSlot;
  readonly onBrand?: boolean;
}

/** The real screenshot when the slot has one, otherwise the placeholder. */
export function AppShot({ app, product, slot, onBrand = false }: AppShotProps) {
  if (!slot.file) {
    return (
      <ShotPlaceholder
        app={app}
        product={product}
        screen={slot.screen}
        note={slot.note}
        rows={slot.rows}
        shape={slot.shape}
        onBrand={onBrand}
      />
    );
  }
  return (
    <figure className={styles.shot} data-on-brand={onBrand || undefined}>
      <img
        src={slot.file}
        alt={slot.alt ?? `${product}: ${slot.screen}`}
        width={slot.width}
        height={slot.height}
        loading="lazy"
        decoding="async"
      />
      <figcaption>
        <strong>{slot.screen}.</strong> {slot.note} A real {product} screen with sample data.
      </figcaption>
    </figure>
  );
}
