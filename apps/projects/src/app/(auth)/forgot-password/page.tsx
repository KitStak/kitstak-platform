import { redirect } from 'next/navigation';
import { appUrls } from '@/server/env';

/**
 * Password reset is one shared KitStak flow (same account in every app), served by CRM's
 * /forgot-password and /reset-password pages. Send people straight there.
 */
export default function ForgotPasswordPage() {
  redirect(`${appUrls().crm}/forgot-password`);
}
