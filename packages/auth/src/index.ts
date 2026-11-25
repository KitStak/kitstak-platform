/**
 * @kitstak/auth — shared Better Auth SSO layer (blueprint §1).
 *
 * Server barrel. The browser client factory is deliberately NOT exported here:
 * import `createKitstakAuthClient` from `@kitstak/auth/client` so the `'use client'`
 * boundary never leaks into server modules. Edge proxies that only need the cookie
 * helpers can import `@kitstak/auth/session-cookie` to avoid pulling in next-js code.
 */
export * from './options';
export * from './access-control';
export * from './create-auth';
export * from './password-compat';
export * from './password-policy-plugin';
export * from './timing';
export * from './sign-in-block';
export * from './front-door';
export { getKitstakSessionCookie, hasKitstakSessionCookie } from './session-cookie';
