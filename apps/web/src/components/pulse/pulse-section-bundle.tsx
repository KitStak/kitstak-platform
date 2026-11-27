import Link from 'next/link';
import { BUNDLE_OFF } from '@/lib/pricing';
import cta from '../product/cta.module.css';
import { FULL_STACK, PULSE_IS_LIVE, ROUTES, getStartedHref } from '../site-links';
import { StakMark } from '../stak-mark';
import pulse from './pulse-section.module.css';
import { BUNDLE, HERO } from './pulse-content';

interface PulseBundleSectionProps {
  readonly visual: React.ReactNode;
}

/**
 * "Works on its own or as a bundle". The same navy band as `BundleBand` (it reuses that band's
 * styles), but it sells two paths instead of one cross-sell, because Pulse stands alone and
 * also links to every other app. The visual beside the copy shows what each link carries. It is a
 * real screen full of small print, so on a wide screen it gets the wider column.
 */
export function PulseBundleSection({ visual }: PulseBundleSectionProps) {
  return (
    <section id="together" className={`section ${cta.bundle}`} aria-labelledby="together-heading">
      <div className={`container ${cta.bundleGrid} ${pulse.bundleWide}`}>
        <div>
          <p className={cta.saving} data-reveal>
            <StakMark lit="both" size={28} />
            Save {BUNDLE_OFF} when you stack two or more
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
          {/* While Pulse is coming soon the main button books a walkthrough. The setup wizard leaves
              Pulse out, so its button says it sets up the other apps. */}
          <div className={cta.actions} data-reveal>
            <Link
              href={PULSE_IS_LIVE ? getStartedHref(FULL_STACK) : ROUTES.demo}
              className="btn btn-primary btn-lg"
            >
              {PULSE_IS_LIVE ? BUNDLE.primaryLabel : HERO.walkthroughLabel}{' '}
              <span className="btn-arrow" aria-hidden>
                →
              </span>
            </Link>
            <Link
              href={PULSE_IS_LIVE ? getStartedHref('pulse') : getStartedHref(FULL_STACK)}
              className="btn btn-ghost-inverse btn-lg"
            >
              {PULSE_IS_LIVE ? BUNDLE.startLabel : BUNDLE.othersLabel}
            </Link>
          </div>
        </div>
        <div data-reveal>{visual}</div>
      </div>
    </section>
  );
}
