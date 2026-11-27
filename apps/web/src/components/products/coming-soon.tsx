import Link from 'next/link';
import { PLANNED_PRICE_NOTE, priceInWords } from '@/lib/pricing';
import { AppIcon } from '../app-icon';
import { COMING_SOON, ROUTES, startLink } from '../site-links';
import type { PlannedProductId } from '../site-links';
// The same card as the live line-up, so the two rows read as one set.
import styles from './products-sections.module.css';

interface PlannedCard {
  readonly id: PlannedProductId;
  readonly name: string;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
  readonly href: string;
}

/** Every point is a part of the app in docs/crew/REFERENCE.md or docs/ledger/REFERENCE.md section 3. */
const CARDS: readonly PlannedCard[] = [
  {
    id: 'crew',
    name: 'KitStak Crew',
    title: 'For the people.',
    body: 'Schedule the floor, clock people in at the door, and see how many people tomorrow needs.',
    points: [
      'Everyone on the floor, temps included',
      'Shift templates, swaps and open shifts',
      'Kiosk and phone time clock',
      'Attendance and time off',
      'Certifications with expiry warnings',
      'A labor plan that shows the people gap',
    ],
    href: ROUTES.crew,
  },
  {
    id: 'ledger',
    name: 'KitStak Ledger',
    title: 'For the money.',
    body: 'Turn WMS bill lines into invoices, collect what you are owed, pay your bills and close the month once.',
    points: [
      'Invoices from WMS bill lines and Pulse',
      'Collections, aging and reminders',
      'Vendor bills and payments',
      'Expenses with receipt photos',
      'Bank reconciliation',
      'One month-end close, shared with Pulse',
    ],
    href: ROUTES.ledger,
  },
];

interface ComingSoonProps {
  /** The heading. The products page and the home page word it differently. */
  readonly title?: string;
  readonly lead?: string;
}

/** Crew and Ledger, with their planned prices and a way to be told when they open. */
export function ComingSoon({
  title = 'Next on the stack.',
  lead = 'Two more apps are on the way: Crew for the people on your floor, and Ledger for the money. Both will share the same sign-in, customers and bill as the rest. The prices are planned: you cannot buy either yet.',
}: ComingSoonProps) {
  return (
    <section id="coming-soon" className="section" aria-labelledby="coming-soon-heading">
      <div className="container">
        <h2 id="coming-soon-heading" className="h2" data-reveal>
          {title}
        </h2>
        <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
          {lead}
        </p>
        <div className={styles.cards}>
          {CARDS.map((card, i) => {
            const notify = startLink(card.id);
            return (
              <article
                key={card.id}
                className={styles.card}
                data-reveal
                style={{ '--reveal-delay': 100 * i } as React.CSSProperties}
              >
                <header className={styles.cardHead}>
                  <AppIcon app={card.id} size={56} />
                  <span className={styles.cardName}>{card.name}</span>
                  <span className={styles.cardSoon}>{COMING_SOON}</span>
                  <span className={styles.cardPrice} title={PLANNED_PRICE_NOTE}>
                    {priceInWords(card.id)}
                  </span>
                </header>
                <h3 className={styles.cardTitle}>{card.title}</h3>
                <p className={styles.cardBody}>{card.body}</p>
                <ul className={styles.cardPoints}>
                  {card.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className={styles.cardActions}>
                  <Link href={card.href} className="btn btn-ghost">
                    Explore {card.name}{' '}
                    <span className="btn-arrow" aria-hidden>
                      →
                    </span>
                  </Link>
                  <Link href={notify.href} className="text-link">
                    {notify.label}
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
