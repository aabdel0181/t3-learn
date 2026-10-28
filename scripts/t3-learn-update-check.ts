// @effect-diagnostics globalConsole:off
// Drives an installed T3 Learn through an in-app update from a local feed
// (T3CODE_DESKTOP_MOCK_UPDATES), up to the point where it quits to install.
//   node scripts/t3-learn-update-check.ts --executable <app> --feed-port <port> --expect <version>
import * as NodeUtil from "node:util";

import { _electron } from "playwright-core";

const { values } = NodeUtil.parseArgs({
  options: {
    executable: { type: "string" },
    "feed-port": { type: "string" },
    expect: { type: "string" },
  },
});
const { executable, expect: expectedVersion } = values;
const feedPort = values["feed-port"];
if (!executable || !feedPort || !expectedVersion) {
  throw new Error(
    "Usage: t3-learn-update-check.ts --executable <app> --feed-port <port> --expect <version>",
  );
}

const STEP_TIMEOUT_MS = 120_000;

interface DesktopBridge {
  readonly checkForUpdate: () => Promise<unknown>;
  readonly downloadUpdate: () => Promise<unknown>;
  readonly installUpdate: () => Promise<unknown>;
  readonly getUpdateState: () => Promise<{
    readonly status: string;
    readonly availableVersion: string | null;
    readonly downloadedVersion: string | null;
  }>;
}
declare const window: { readonly desktopBridge: DesktopBridge };

const app = await _electron.launch({
  executablePath: executable,
  env: {
    ...process.env,
    T3CODE_DESKTOP_MOCK_UPDATES: "true",
    T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT: feedPort,
    T3CODE_TELEMETRY_ENABLED: "false",
  },
  timeout: STEP_TIMEOUT_MS,
});
const page = await app.firstWindow({ timeout: STEP_TIMEOUT_MS });
// The first window navigates while the app starts; locator waits outlast that.
await page
  .getByRole("dialog")
  .or(page.getByText("What should we work on?"))
  .first()
  .waitFor({ timeout: STEP_TIMEOUT_MS });

// The app may already be checking on its own at startup, so wait on the state.
await page.evaluate(() => window.desktopBridge.checkForUpdate());
await page.waitForFunction(
  async () => (await window.desktopBridge.getUpdateState()).availableVersion !== null,
  undefined,
  { timeout: STEP_TIMEOUT_MS },
);
const available = await page.evaluate(() => window.desktopBridge.getUpdateState());
console.log(`after check: ${JSON.stringify(available)}`);
if (available.availableVersion !== expectedVersion) {
  throw new Error(`expected update ${expectedVersion}, got ${JSON.stringify(available)}`);
}

await page.evaluate(() => window.desktopBridge.downloadUpdate());
await page.waitForFunction(
  async () => (await window.desktopBridge.getUpdateState()).downloadedVersion !== null,
  undefined,
  { timeout: STEP_TIMEOUT_MS },
);
const downloaded = await page.evaluate(() => window.desktopBridge.getUpdateState());
console.log(`after download: ${JSON.stringify(downloaded)}`);
if (downloaded.downloadedVersion !== expectedVersion) {
  throw new Error(`the update did not download: ${JSON.stringify(downloaded)}`);
}

// The app quits to install; the caller checks the result. A relaunched app can
// inherit this connection's pipes, so waiting for it to close would never end.
await page.evaluate(() => window.desktopBridge.installUpdate()).catch(() => undefined);
console.log("asked the app to install the update");
process.exit(0);
