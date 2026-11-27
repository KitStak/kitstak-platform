import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password' };

/** Asks for the email and always answers the same way, whether or not it has an account. */
export default async function ForgotPasswordPage() {
  if (await getSession()) redirect('/');
  return <ForgotPasswordForm />;
}
