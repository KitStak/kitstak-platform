import Link from 'next/link';
import { PRICING, percentLabel } from '@/lib/pricing';
import { ROUTES, getStartedHref } from '../site-links';
import { StakMark } from '../stak-mark';
import styles from './cta.module.css';

interface BundleBandProps {
  /** The product page this sits on; the band sells the other one. */
  readonly from: 'wms' | 'crm';
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly visual: React.ReactNode;
}

const OTHER = {
  wms: { name: 'KitStak CRM', href: ROUTES.crm },
  crm: { name: 'KitStak WMS', href: ROUTES.wms },
} as const;

/** Cross-sell: what this product gains from the other one, and the bundle saving. */
export function BundleBand({ from, title, body, points, visual }: BundleBandProps) {
  const other = OTHER[from];
  return (
    <section id="together" className={`section ${styles.bundle}`} aria-labelledby="together-heading">
      <div className={`container ${styles.bundleGrid}`}>
        <div>
          <p className={styles.saving} data-reveal>
            <StakMark lit="both" size={28} />
            Save {percentLabel(PRICING.bundleDiscount)} when you run both
          </p>
          <h2 id="together-heading" className={`h2 ${styles.bundleTitle}`} data-reveal>
            {title}
          </h2>
          <p className={`lead ${styles.onBrandLead}`} data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
            {body}
          </p>
          <ul className={styles.points}>
            {points.map((point, i) => (
              <li key={point} data-reveal style={{ '--reveal-delay': 60 * i } as React.CSSProperties}>
                <Check />
                {point}
              </li>
            ))}
          </ul>
          <div className={styles.actions} data-reveal>
            <Link href={getStartedHref(['crm', 'wms'])} className="btn btn-primary btn-lg">
              Build the bundle <span className="btn-arrow" aria-hidden>→</span>
            </Link>
            <Link href={other.href} className="btn btn-ghost-inverse btn-lg">
              See {other.name}
            </Link>
          </div>
        </div>
        <div data-reveal>{visual}</div>
      </div>
    </section>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

interface FounderBandProps {
  readonly title?: string;
  readonly body?: string;
}

/** "Talk to the founder" call to action. Booking is a placeholder that lands on /contact. */
export function FounderBand({
  title = 'Talk to the founder, not a sales team.',
  body = 'Twenty minutes, your operation, no slides. Bring the spreadsheet you are trying to retire and leave with a plan for replacing it.',
}: FounderBandProps) {
  return (
    <section className={`section ${styles.founder}`} aria-labelledby="founder-heading">
      <div className={`container ${styles.founderGrid}`}>
        <div className={styles.founderMark} aria-hidden data-reveal>
          <span />
          <span />
        </div>
        <div>
          <h2 id="founder-heading" className={`h2 ${styles.founderTitle}`} data-reveal>
            {title}
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
            {body}
          </p>
          <div className={styles.actions} data-reveal>
            <Link href={ROUTES.founder} className="btn btn-primary btn-lg">
              Talk to the founder <span className="btn-arrow" aria-hidden>→</span>
            </Link>
            <Link href={ROUTES.contact} className="btn btn-ghost btn-lg">
              Send a message
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

interface FaqProps {
  readonly items: readonly FaqItem[];
  readonly title?: string;
}

export function Faq({ items, title = 'Questions, answered.' }: FaqProps) {
  return (
    <section id="faq" className={`section ${styles.faq}`} aria-labelledby="faq-heading">
      <div className={`container ${styles.faqGrid}`}>
        <div>
          <h2 id="faq-heading" className="h2" data-reveal>
            {title}
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
            Something else on your mind?{' '}
            <Link href={ROUTES.contact} className="text-link">
              Ask us
            </Link>
          </p>
        </div>
        <div className={styles.faqList}>
          {items.map((item) => (
            <details key={item.question} className={styles.faqItem} data-reveal>
              <summary>
                <span>{item.question}</span>
                <span className={styles.plus} aria-hidden />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
