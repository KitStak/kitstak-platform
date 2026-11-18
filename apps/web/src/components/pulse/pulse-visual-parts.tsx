import mock from '../mock/mock.module.css';
import { STATUS, type RiskStatus } from './pulse-visual-data';
import styles from './pulse-visuals.module.css';

/*
 * Official Pulse brand files, copied unchanged to public/brand. They are always referenced as files.
 * The mark is never redrawn here.
 */
const PULSE_ICON = '/brand/apps/kitstak-icon-pulse.svg';
const PULSE_LOADER = '/brand/loaders/kitstak-loader-pulse.svg';
const PULSE_LOGO_ON_LIGHT = '/brand/logos/kitstak-logo-pulse-on-light.svg';
const PULSE_LOGO_ON_DARK = '/brand/logos/kitstak-logo-pulse-on-dark.svg';

/** The lettered logo artboard is 1045 by 200: the Pulse icon, KITSTAK, a divider, then PULSE. */
const LOGO_RATIO = 1045 / 200;

interface SizeProps {
  readonly size?: number;
  readonly className?: string;
}

/** The Pulse app icon. Decorative: the name is always written beside it. */
export function PulseIcon({ size = 32, className }: SizeProps) {
  return (
    <img
      src={PULSE_ICON}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ flex: 'none' }}
    />
  );
}

/**
 * The official Pulse loader. It loops on its own and holds still for people who prefer reduced motion.
 * Decorative by default: say what is happening in text beside it.
 */
export function PulseLoader({ size = 40, className }: SizeProps) {
  return (
    <img
      src={PULSE_LOADER}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={className}
      style={{ flex: 'none' }}
    />
  );
}

interface PulseWordmarkProps {
  readonly height?: number;
  /** `auto` follows the theme. `inverse` is always the cream file, for a band that is navy in both. */
  readonly tone?: 'auto' | 'inverse';
}

/** The lettered Pulse logo: navy letters on light surfaces, cream letters on dark ones. */
export function PulseWordmark({ height = 40, tone = 'auto' }: PulseWordmarkProps) {
  const width = Math.round(height * LOGO_RATIO);
  if (tone === 'inverse') {
    return (
      <span className={styles.wordmark} style={{ width, height }}>
        <img src={PULSE_LOGO_ON_DARK} alt="KitStak Pulse" width={width} height={height} />
      </span>
    );
  }
  return (
    <span className={styles.wordmark} style={{ width, height }}>
      <img
        src={PULSE_LOGO_ON_LIGHT}
        alt="KitStak Pulse"
        width={width}
        height={height}
        className={styles.onLight}
      />
      <img
        src={PULSE_LOGO_ON_DARK}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className={styles.onDark}
      />
    </span>
  );
}

/* ===== Cost and profit ===== */

interface SplitBarProps {
  /** Whole percents of revenue. They add up to 100. */
  readonly out: number;
  readonly profit: number;
  /** What the profit is, for the text alternative: "profit on jobs", "profit so far". */
  readonly what: string;
}

/**
 * The picture the page keeps coming back to: one bar for every dollar of revenue, split into
 * cost and profit. The same two colors and the same key every time it appears.
 */
export function SplitBar({ out, profit, what }: SplitBarProps) {
  return (
    <>
      <div
        className={styles.splitBar}
        role="img"
        aria-label={`Of every dollar of revenue, ${out} cents went to cost and ${profit} cents stayed as ${what}.`}
      >
        <span style={{ flexGrow: out }} data-part="out" />
        <span style={{ flexGrow: profit }} data-part="profit" />
      </div>
      <div className={styles.splitKey} aria-hidden>
        <span data-part="out">Cost {out}%</span>
        <span data-part="profit">Profit {profit}%</span>
      </div>
    </>
  );
}

/* ===== Status ===== */

const STATUS_GLYPH: Readonly<Record<RiskStatus, React.ReactNode>> = {
  'losing-money': <path d="M2 4.5l4 4 2.5-2.5L14 11.5M14 7.5v4h-4" />,
  'at-risk': <path d="M8 2.2l6.2 11H1.8zM8 6.6v3M8 11.6v.4" />,
  'heads-up': <path d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM8 7.4v3.4M8 5v.4" />,
  'not-enough-data': <path strokeDasharray="2.4 2.4" d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z" />,
  'on-track': <path d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM5.2 8.2l2 2 3.6-4" />,
};

/** A status is always an icon and the word, never the color alone. */
export function StatusPill({ status, count }: { readonly status: RiskStatus; readonly count?: number }) {
  const { label, token } = STATUS[status];
  return (
    <span
      className={`${mock.pill} ${styles.status}`}
      style={
        {
          '--tone-subtle': `var(--label-${token}-subtle)`,
          '--tone-text': `var(--label-${token}-text)`,
        } as React.CSSProperties
      }
    >
      <svg
        viewBox="0 0 16 16"
        width="13"
        height="13"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {STATUS_GLYPH[status]}
      </svg>
      {label}
      {count === undefined ? null : <span className={styles.statusCount}>{count}</span>}
    </span>
  );
}

/** A job number in the mono face, then its name. */
export function JobName({ code, name }: { readonly code?: string; readonly name: string }) {
  return (
    <span className={styles.job}>
      {code ? <span className={styles.jobCode}>{code}</span> : null}
      <span className={styles.jobTitle}>{name}</span>
    </span>
  );
}
