/**
 * Compatibility entry point. The nav map lives in `src/config/nav-config.ts` (F4.7).
 * `NAV_MENUS` here is the full searchable tree (dashboard, the 7 mega-menus, account and
 * header pages) consumed structurally by `src/server/search/pages.ts`.
 */
import { DASHBOARD_ITEM, HEADER_ITEMS, NAV_MENUS as MEGA_MENUS, USER_MENU_ITEMS } from '@/config/nav-config';

export * from '@/config/nav-config';

export const NAV_MENUS = Object.freeze([
  DASHBOARD_ITEM,
  ...MEGA_MENUS,
  { label: 'Account', items: USER_MENU_ITEMS },
  ...HEADER_ITEMS,
]);
