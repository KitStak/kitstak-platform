import { redirect } from 'next/navigation';
import { appUrls } from '@/server/env';

/**
 * One place to reset a password (billing review round 4): the Portal. It emails a 6 digit code and
 * the new password works in every KitStak app. This page used to go to the CRM, whose page said
 * "ask your KitStak administrator".
 */
export default function ForgotPasswordPage() {
  redirect(`${appUrls().portal}/forgot-password`);
}
