import Link from 'next/link';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PRODUCT_NAV } from '@/components/nav/nav-data';
import { ROUTES, START_LABEL, startFreeHref } from '@/components/site-links';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main">
        <section id="top" className={styles.band}>
          <div className="container">
            <p className={`numeral ${styles.code}`}>404</p>
            <h1 className={styles.title}>That shelf is empty.</h1>
            <p className={styles.lead}>The page you were looking for is not here. These are.</p>
            <ul className={styles.links}>
              {PRODUCT_NAV.map((product) => (
                <li key={product.id}>
                  <Link href={product.href}>{product.name}</Link>
                </li>
              ))}
              <li>
                <Link href={ROUTES.products}>Compare products</Link>
              </li>
              <li>
                <a href={startFreeHref()}>{START_LABEL}</a>
              </li>
              <li>
                <Link href={ROUTES.home}>Home</Link>
              </li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
