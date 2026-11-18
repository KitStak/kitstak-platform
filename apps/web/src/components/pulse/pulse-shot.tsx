import {
  PULSE_SHOTS,
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
 * match the visitor's system theme. Otherwise it renders the coded visual passed in.
 */
export function PulseShot({ slot, onBrand = false, children }: PulseShotProps) {
  const shot = PULSE_SHOTS[slot];
  const desktop = shot.views.at(-1);
  if (!shot.ready || !desktop) return <>{children}</>;

  const sources = shot.views.flatMap((view) =>
    (['dark', 'light'] as const).flatMap((theme) => [
      <source
        key={`${view.view}-${theme}-avif`}
        type="image/avif"
        media={mediaFor(view, theme)}
        srcSet={avifSet(shot, view, theme)}
        sizes={shot.sizes}
        width={view.width}
        height={view.height}
      />,
      <source
        key={`${view.view}-${theme}-webp`}
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
      style={shot.maxWidth ? { maxWidth: shot.maxWidth } : undefined}
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
        <strong>{shot.label}.</strong> A real KitStak Pulse screen with sample data.
      </figcaption>
    </figure>
  );
}
