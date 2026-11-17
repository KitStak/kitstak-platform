import type { Metadata } from 'next';
import { CalculatorPage } from '@/features/calculator';

export const metadata: Metadata = { title: 'Calculator' };

export default function Page() {
  return <CalculatorPage />;
}
