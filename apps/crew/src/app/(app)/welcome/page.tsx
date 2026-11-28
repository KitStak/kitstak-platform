import type { Metadata } from 'next';
import { WelcomePage } from '@/features/welcome/welcome-page';

export const metadata: Metadata = { title: 'Getting started' };

export default function Page() {
  return <WelcomePage />;
}
