/**
 * Better Auth handler (blueprint §1.4): every auth flow — sign-in/out, change/reset
 * password, organization + session endpoints — is served by the shared instance at
 * /api/auth/*. The explicit sibling routes (sso/*, forgot, reset) win over this
 * catch-all for their exact paths.
 */
import { getWmsAuth } from '@/server/auth/auth';

async function handler(request: Request): Promise<Response> {
  const auth = await getWmsAuth();
  return auth.handler(request);
}

export { handler as GET, handler as POST };
