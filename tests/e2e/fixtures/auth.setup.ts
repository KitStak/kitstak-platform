/**
 * Playwright "auth-setup" project: logs in once per role and saves the browser
 * storage state to .data/e2e-auth/<role>.json for every other project to reuse.
 */
import fs from "node:fs";
import { test as setup } from "@playwright/test";
import { loginViaApi } from "./login";
import { AUTH_STATE_DIR, ROLES, storageStatePath } from "./roles";

setup.beforeAll(() => {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
});

for (const role of ROLES) {
  setup(`authenticate as ${role}`, async ({ request }) => {
    await loginViaApi(request, role);
    await request.storageState({ path: storageStatePath(role) });
  });
}
