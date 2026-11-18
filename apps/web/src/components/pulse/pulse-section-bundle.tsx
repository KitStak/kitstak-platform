import Link from 'next/link';
import { PRICING, percentLabel } from '@/lib/pricing';
import cta from '../product/cta.module.css';
import { FULL_STACK, getStartedHref } from '../site-links';
import { StakMark } from '../stak-mark';
import { BUNDLE } from './pulse-content';

interface PulseBundleSectionProps {
  readonly visual: React.ReactNode;
}

/**
 * "Works on its own or as a bundle". The same navy band as `BundleBand` (it reuses that band's
 * styles), but it sells two paths instead of one cross-sell, because Pulse stands alone and
 * also links to every other app. The visual beside the copy shows what each link carries.
 */
export function PulseBundleSection({ visual }: PulseBundleSectionProps) {
  return (
    <section id="together" className={`section ${cta.bundle}`} aria-labelledby="together-heading">
      <div className={`container ${cta.bundleGrid}`}>
        <div>
          <p className={cta.saving} data-reveal>
            <StakMark lit="both" size={28} />
            Save {percentLabel(PRICING.bundleDiscount)} when you stack two or more
          </p>
          <h2 id="together-heading" className={`h2 ${cta.bundleTitle}`} data-reveal>
            {BUNDLE.title}
          </h2>
          <p
            className={`lead ${cta.onBrandLead}`}
            data-reveal
            style={{ '--reveal-delay': 100 } as React.CSSProperties}
          >
            {BUNDLE.body}
          </p>
          <div className={cta.actions} data-reveal>
            <Link href={getStartedHref(FULL_STACK)} className="btn btn-primary btn-lg">
              {BUNDLE.primaryLabel}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </Link>
            <Link href={getStartedHref('pulse')} className="btn btn-ghost-inverse btn-lg">
              {BUNDLE.secondaryLabel}
            </Link>
          </div>
        </div>
        <div data-reveal>{visual}</div>
      </div>
    </section>
  );
}
