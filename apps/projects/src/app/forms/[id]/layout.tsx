import type { Metadata } from 'next';

/** Fallback title for unknown or closed links; a live form's page names the form itself. */
export const metadata: Metadata = { title: { absolute: 'Form not available · KitStak' }, robots: { index: false, follow: false } };

export default function FormLayout({ children }: { readonly children: React.ReactNode }) {
  return children;
}
