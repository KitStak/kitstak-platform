import { AppIcon } from '../app-icon';
import type { AppId } from '../app-icon';
import styles from './shot-placeholder.module.css';

interface ShotPlaceholderProps {
  /** The app the screen belongs to. Its icon and name sit in the window bar. */
  readonly app: AppId;
  /** "KitStak Crew" */
  readonly product: string;
  /** The screen the real picture will show, e.g. "Weekly schedule". */
  readonly screen: string;
  /** One line on what the screen will show. */
  readonly note: string;
  /** Rows of grey bars drawn in the window, so the frame reads as a screen. Defaults to 5. */
  readonly rows?: number;
  /** `wide` for a full-width table screen, `narrow` for a phone or a dialog beside the copy. */
  readonly shape?: 'wide' | 'narrow';
  /** Set when the frame sits on the navy brand band, so the caption is light. */
  readonly onBrand?: boolean;
}

/** Widths of the grey bars in each row, as a share of the row. Fixed, so every build draws the same frame. */
const BAR_PATTERN = [
  [34, 18, 22, 14],
  [26, 24, 16, 20],
  [40, 12, 20, 16],
  [22, 28, 18, 18],
  [30, 20, 26, 10],
  [36, 16, 14, 22],
  [24, 22, 24, 16],
] as const;

/**
 * A stand-in for a product screenshot of an app that is not built yet (Crew, Ledger). It is framed
 * like the real screenshots on the Pulse page (same border, radius and shadow) and says plainly that
 * it is a placeholder, so nobody takes it for the product. Swap it for a real screenshot when the
 * app ships.
 */
export function ShotPlaceholder({
  app,
  product,
  screen,
  note,
  rows = 5,
  shape = 'wide',
  onBrand = false,
}: ShotPlaceholderProps) {
  const lines = Array.from({ length: Math.min(rows, BAR_PATTERN.length) }, (_, i) => BAR_PATTERN[i]!);
  return (
    <figure className={styles.shot} data-shape={shape} data-on-brand={onBrand || undefined}>
      <div className={styles.window} role="img" aria-label={`Placeholder for the ${product} ${screen} screen`}>
        <div className={styles.bar} aria-hidden>
          <AppIcon app={app} size={22} />
          <span className={styles.barName}>{product}</span>
          <span className={styles.barScreen}>{screen}</span>
        </div>
        <div className={styles.body} aria-hidden>
          <div className={styles.rows}>
            {lines.map((widths, row) => (
              <div key={row} className={styles.row}>
                {widths.map((width, cell) => (
                  <span key={cell} style={{ '--w': `${width}%` } as React.CSSProperties} />
                ))}
              </div>
            ))}
          </div>
          <p className={styles.stamp}>
            <span className={styles.stampKicker}>Screenshot coming</span>
            <span className={styles.stampScreen}>{screen}</span>
          </p>
        </div>
      </div>
      <figcaption>
        <strong>{screen}.</strong> {note} Placeholder: the real {product} screen goes here when the app ships.
      </figcaption>
    </figure>
  );
}
