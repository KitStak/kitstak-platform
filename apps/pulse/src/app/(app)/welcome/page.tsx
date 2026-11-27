import type { Metadata } from 'next';
import { WelcomePage } from '@/features/welcome';

export const metadata: Metadata = { title: 'Getting started' };

export default function Page() {
  return <WelcomePage />;
}
