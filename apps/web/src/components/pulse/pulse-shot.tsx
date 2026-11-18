import {
  PULSE_SHOTS,
  PULSE_SHOT_THEMES,
  SIDE_COLUMN_SIZES,
  SIDE_COLUMN_VIEWS,
  fullSizeFile,
  shotFile,
  type PulseShotId,
  type PulseShotSlot,
  type PulseShotTheme,
  type PulseShotView,
} from './pulse-shots';
import styles from './pulse-shot.module.css';

interface PulseShotProps {
  readonly slot: PulseShotId;
  /** Set when the picture sits on the navy brand band, so the caption is light. */
  readonly onBrand?: boolean;
  /** Set when the picture sits in a side column, about half the page wide, instead of across it. */
  readonly inSideColumn?: boolean;
  /** The coded visual shown when the slot has no real screenshot. */
  readonly children: React.ReactNode;
}

/** The media query for one view and theme. Dark sources come first, so light ones need no theme. */
function mediaFor(view: PulseShotView, theme: PulseShotTheme): string | undefined {
  const parts: string[] = [];
  if (theme === 'dark') parts.push('(prefers-color-scheme: dark)');
  if (view.upTo) parts.push(`(max-width: ${view.upTo}px)`);
  return parts.length > 0 ? parts.join(' and ') : undefined;
}

function avifSet(slot: PulseShotSlot, view: PulseShotView, theme: PulseShotTheme): string {
  return view.widths.map((width) => `${shotFile(slot, view, theme, width, 'avif')} ${width}w`).join(', ');
}

/** The smallest file of a view, as WebP, for browsers without AVIF. */
function webpFile(slot: PulseShotSlot, view: PulseShotView, theme: PulseShotTheme): string {
  return shotFile(slot, view, theme, view.widths[0] ?? view.width, 'webp');
}

/**
 * One visual slot on the Pulse page. When the slot is marked ready in pulse-shots.ts it renders the
 * real product screenshot: the phone, tablet or desktop capture to fit the screen, light or dark to
 * match the visitor's system theme. Otherwise it renders the coded visual passed in. In a side column
 * the slot must be the Jobs screen, the one screen with a picture made for a narrow column.
 *
 * The caption ends with a link that opens the screen at full size, and the link covers the picture
 * too, so a click or a tap on the picture opens it. There is one link for each theme and the style
 * sheet shows the one that matches the picture.
 */
export function PulseShot({ slot, onBrand = false, inSideColumn = false, children }: PulseShotProps) {
  const shot = PULSE_SHOTS[slot];
  const views = inSideColumn ? SIDE_COLUMN_VIEWS : shot.views;
  const sizes = inSideColumn ? SIDE_COLUMN_SIZES : shot.sizes;
  const desktop = views.at(-1);
  if (!shot.ready || !desktop) return <>{children}</>;

  const sources = views.flatMap((view, index) =>
    (['dark', 'light'] as const).flatMap((theme) => [
      <source
        key={`${index}-${theme}-avif`}
        type="image/avif"
        media={mediaFor(view, theme)}
        srcSet={avifSet(shot, view, theme)}
        sizes={sizes}
        width={view.width}
        height={view.height}
      />,
      <source
        key={`${index}-${theme}-webp`}
        type="image/webp"
        media={mediaFor(view, theme)}
        srcSet={webpFile(shot, view, theme)}
        width={view.width}
        height={view.height}
      />,
    ]),
  );

  return (
    <figure
      className={styles.shot}
      data-on-brand={onBrand || undefined}
      data-phone-on-tablet={(!inSideColumn && shot.phoneOnTablet) || undefined}
      data-phone-in-column={inSideColumn ? 'side-column' : shot.phoneInColumn}
      style={shot.maxWidth ? ({ '--shot-max': `${shot.maxWidth}px` } as React.CSSProperties) : undefined}
    >
      <picture>
        {sources}
        <img
          src={webpFile(shot, desktop, 'light')}
          alt={shot.alt}
          width={desktop.width}
          height={desktop.height}
          loading={shot.priority ? 'eager' : 'lazy'}
          fetchPriority={shot.priority ? 'high' : 'auto'}
          decoding="async"
        />
      </picture>
      <figcaption>
        <strong>{shot.label}.</strong> A real KitStak Pulse screen with sample data. The clients and jobs are
        made up.{' '}
        {PULSE_SHOT_THEMES.map((theme) => (
          <a key={theme} className={styles.full} data-theme={theme} href={fullSizeFile(shot, theme)}>
            Open it full size
            <span className="visually-hidden">: {shot.label}</span>
          </a>
        ))}
      </figcaption>
    </figure>
  );
}
