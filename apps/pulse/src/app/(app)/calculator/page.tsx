import type { Metadata } from 'next';
import { CalculatorPage } from '@/features/calculator';

export const metadata: Metadata = { title: 'Calculator' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CalculatorPage searchParams={searchParams} />;
}
