import mock from '../mock/mock.module.css';
import styles from './wms-visuals.module.css';

const DISPOSITIONS = [
  { name: 'Restock', units: 4, token: 'green' },
  { name: 'Damaged', units: 1, token: 'orange' },
  { name: 'Quarantine', units: 1, token: 'purple' },
  { name: 'Dispose', units: 0, token: 'gray' },
] as const;
const RETURNED = DISPOSITIONS.reduce((sum, d) => sum + d.units, 0);

const COMPONENTS = [
  { sku: 'KS-5120', name: 'Gift box, large', per: 1 },
  { sku: 'KS-1042', name: 'Trail bottle, 24 oz', per: 2 },
  { sku: 'KS-3150', name: 'Camp mug, enamel', per: 2 },
] as const;
const KITS = 120;

/** Two small panels: a return being dispositioned, and a kit being built from components. */
export function ReturnsKitting() {
  return (
    <div className={styles.duo}>
      <div className={mock.panel}>
        <div className={mock.head}>
          <div>
            <div className={mock.title}>Return Station</div>
            <div className={mock.sub}>RMA-2207 · Ridgeline Outfitters · {RETURNED} units</div>
          </div>
        </div>
        <ul className={styles.dispositions}>
          {DISPOSITIONS.map((d) => (
            <li key={d.name}>
              <span className={styles.dispName}>{d.name}</span>
              <span className={styles.dispTrack} aria-hidden>
                <span
                  style={{ transform: `scaleX(${d.units / RETURNED})`, background: `var(--label-${d.token})` }}
                />
              </span>
              <span className={`numeral ${styles.dispUnits}`}>{d.units}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${mock.panel} ${styles.kitPanel}`}>
        <div className={mock.head}>
          <div>
            <div className={mock.title}>Work order WO-311</div>
            <div className={mock.sub}>Build {KITS} gift kits · Harbor &amp; Pine</div>
          </div>
          <span className={`numeral ${styles.kitCount}`}>{KITS}</span>
        </div>
        <ul className={mock.rows}>
          {COMPONENTS.map((c) => (
            <li key={c.sku} className={mock.row}>
              <span>
                <span className={mock.mono}>{c.sku}</span> <span className={mock.muted}>{c.name}</span>
              </span>
              <span>
                {c.per} per kit · <strong>{c.per * KITS}</strong>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
