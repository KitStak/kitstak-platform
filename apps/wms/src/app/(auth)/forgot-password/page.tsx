import type { Metadata } from 'next';
import { AuthFrame } from '@/components/layout/auth-frame';
import { ForgotPasswordForm } from '@/components/layout/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame
      title="Forgot password?"
      description="We'll email you a link to choose a new password."
    >
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
