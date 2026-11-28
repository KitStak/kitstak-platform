'use client';
/** Browser auth client (shared `@kitstak/auth` factory): sign-in, sign-out, org switching. */
import { createKitstakAuthClient } from '@kitstak/auth/client';

export const authClient = createKitstakAuthClient();

export const { signIn, signOut, useSession, organization } = authClient;
