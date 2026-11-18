import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { CrmSection } from '@/components/crm/crm-section';
import { FlowSection } from '@/components/flow/flow-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { Hero } from '@/components/hero/hero';
import { LicensingSection } from '@/components/licensing/licensing-section';
import { PageEffects } from '@/components/page-effects';
import { WmsSection } from '@/components/wms/wms-section';

/** Title, description and social tags come from the root layout. The home page adds its canonical. */
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function HomePage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <Hero />
        <FlowSection />
        <WmsSection />
        <CrmSection />
        <LicensingSection />
        <ClosingSection />
      </main>
      <Footer />
    </>
  );
}
