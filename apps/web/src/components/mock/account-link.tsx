import { AppIcon } from '../app-icon';
import mock from './mock.module.css';
import styles from './account-link.module.css';

const ORDERS = [
  { number: 'SO-10482', status: 'Picking', token: 'orange' },
  { number: 'SO-10479', status: 'Packed', token: 'sky' },
  { number: 'SO-10471', status: 'Shipped', token: 'green' },
] as const;

/**
 * The CRM account page with its "Warehouse (WMS)" card: the account is linked to the same
 * customer the warehouse ships for, and shows open shipment orders and on-hand units.
 */
export function AccountLink() {
  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Northwind Supply</div>
          <div className={mock.sub}>Account · Columbus, OH · owner Dana R.</div>
        </div>
        <span
          className={mock.pill}
          style={
            { '--tone-subtle': 'var(--label-green-subtle)', '--tone-text': 'var(--label-green-text)' } as React.CSSProperties
          }
        >
          Active account
        </span>
      </div>

      <div className={styles.split}>
        <div className={styles.crm}>
          <div className={styles.cardLabel}>
            <AppIcon app="crm" size={26} /> CRM
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>Open deals</dt>
              <dd>2 · $79,950</dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd>Renewal call, Thursday</dd>
            </div>
            <div>
              <dt>Contacts</dt>
              <dd>4 people</dd>
            </div>
          </dl>
        </div>

        <div className={styles.wms}>
          <div className={styles.cardLabel}>
            <AppIcon app="wms" size={26} /> Warehouse (WMS)
          </div>
          <div className={styles.onHand}>
            <span className={`numeral ${styles.onHandValue}`}>4,812</span>
            <span className={styles.onHandUnit}>units on hand</span>
          </div>
          <ul className={mock.rows}>
            {ORDERS.map((order) => (
              <li key={order.number} className={mock.row}>
                <span className={mock.mono}>{order.number}</span>
                <span
                  className={mock.pill}
                  style={
                    {
                      '--tone-subtle': `var(--label-${order.token}-subtle)`,
                      '--tone-text': `var(--label-${order.token}-text)`,
                    } as React.CSSProperties
                  }
                >
                  {order.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={mock.caption}>One customer record, shared by both apps. Sample data.</p>
    </div>
  );
}
