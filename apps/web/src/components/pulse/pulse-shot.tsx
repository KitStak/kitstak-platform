import { PULSE_SHOTS, type PulseShotId } from './pulse-shots';
import styles from './pulse-shot.module.css';

interface PulseShotProps {
  readonly slot: PulseShotId;
  /** The coded visual shown until the slot's real screenshots are in place. */
  readonly children: React.ReactNode;
}

/**
 * One visual slot on the Pulse page. When the slot is marked ready in pulse-shots.ts it renders the
 * real product screenshot, light or dark to match the visitor's theme. Until then it renders the coded
 * visual passed in.
 */
export function PulseShot({ slot, children }: PulseShotProps) {
  const shot = PULSE_SHOTS[slot];
  if (!shot.ready) return <>{children}</>;

  return (
    <picture className={styles.shot}>
      <source srcSet={shot.dark} media="(prefers-color-scheme: dark)" />
      <img
        src={shot.light}
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        loading={shot.priority ? 'eager' : 'lazy'}
        fetchPriority={shot.priority ? 'high' : 'auto'}
        decoding="async"
      />
    </picture>
  );
}
