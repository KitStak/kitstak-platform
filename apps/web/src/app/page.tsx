import { ClosingSection } from '@/components/closing/closing-section';
import { CrmSection } from '@/components/crm/crm-section';
import { FlowSection } from '@/components/flow/flow-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { Hero } from '@/components/hero/hero';
import { LicensingSection } from '@/components/licensing/licensing-section';
import { PageEffects } from '@/components/page-effects';
import { WmsSection } from '@/components/wms/wms-section';

export default function HomePage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main>
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
