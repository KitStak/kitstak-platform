import styles from './logo.module.css';

/** Supplied lockup artwork (KitStak Landing Page/Logos and Assets), padding trimmed only. 1200x228. */
const RATIO = 1200 / 228;

interface LogoProps {
  readonly height?: number;
  /** `auto` follows the theme (navy on light, cream on dark); `inverse` is always cream. */
  readonly tone?: 'auto' | 'inverse';
  readonly className?: string;
}

export function Logo({ height = 24, tone = 'auto', className }: LogoProps) {
  const width = Math.round(height * RATIO);
  return (
    <span
      className={[styles.logo, tone === 'inverse' ? styles.inverse : '', className ?? ''].join(' ')}
      style={{ width, height }}
    >
      <img src="/brand/kitstak-lockup-navy.png" alt="KitStak" width={width} height={height} className={styles.navy} />
      <img
        src="/brand/kitstak-lockup-cream.png"
        alt=""
        aria-hidden
        width={width}
        height={height}
        className={styles.cream}
      />
    </span>
  );
}
