import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { getSignupResume, stepHref } from '@/server/signup';
import { firstNameOf } from '@/features/signup/fields';
import { CompanyForm } from './company-form';

export const metadata: Metadata = { title: 'Name your organization' };

/**
 * For a person who has an account but no organization yet: they signed up with Google or
 * Microsoft, or the workspace step failed. One field, then on to the app picker.
 */
export default async function SignupCompanyPage() {
  const session = await getSession();
  if (!session) redirect('/signup');
  const resume = await getSignupResume(session);
  if (resume.step !== '/signup/company') redirect(stepHref(resume.step));
  return <CompanyForm firstName={firstNameOf(session.user.name ?? '')} email={session.user.email} />;
}
