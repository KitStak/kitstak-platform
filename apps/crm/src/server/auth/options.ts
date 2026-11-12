/**
 * Shared Better Auth options now live in `@kitstak/auth` (blueprint §1.3); this module is
 * a compatibility re-export so existing `@/server/auth/options` imports keep working.
 * The schema generator config (`scripts/auth-schema.config.ts`) also consumes this.
 */
export {
  SESSION_COOKIE_PREFIX,
  SESSION_COOKIE_NAMES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  organizationPlugin,
  sharedAuthOptions,
} from '@kitstak/auth/options';
