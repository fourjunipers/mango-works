import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireFileLock } from "../e2e/file-lock";

/**
 * The browser tests' lock file (e2e/file-lock.ts): one holder at a time, a
 * live holder is never robbed, and a lock left by a killed run is taken
 * over soon after it stops being touched.
 */

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mango-lock-test-"));
  path = join(dir, "shop.lock");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fast = { staleMs: 300, heartbeatMs: 50, pollMs: 20 };

describe("the browser tests' lock file", () => {
  it("is held by one at a time, and handed on at release", async () => {
    const release = await acquireFileLock(path, fast);
    let second = false;
    const waiting = acquireFileLock(path, fast).then((r) => {
      second = true;
      return r;
    });
    await sleep(100);
    expect(second).toBe(false);
    release();
    const releaseSecond = await waiting;
    expect(second).toBe(true);
    releaseSecond();
    expect(existsSync(path)).toBe(false);
  });

  it("is not taken from a holder that outlives the stale time", async () => {
    const release = await acquireFileLock(path, fast);
    let second = false;
    const waiting = acquireFileLock(path, fast).then((r) => {
      second = true;
      return r;
    });
    // Three times the stale time: the heartbeat keeps it alive.
    await sleep(900);
    expect(second).toBe(false);
    release();
    (await waiting)();
  });

  it("takes over a lock left by a killed run once it is stale", async () => {
    // A lock nobody touches, last touched an hour ago.
    writeFileSync(path, "999999 dead");
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(path, hourAgo, hourAgo);
    const started = Date.now();
    const release = await acquireFileLock(path, fast);
    expect(Date.now() - started).toBeLessThan(1_000);
    release();
    expect(existsSync(path)).toBe(false);
  });

  it("waits out a fresh lock nobody touches, for the stale time and no longer", async () => {
    writeFileSync(path, "999999 dead");
    const started = Date.now();
    const release = await acquireFileLock(path, fast);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(2_000);
    release();
  });

  it("a holder that was taken over does not remove the new holder's lock", async () => {
    // No heartbeat within the test: the first holder goes stale.
    const releaseFirst = await acquireFileLock(path, {
      ...fast,
      heartbeatMs: 60_000,
    });
    const releaseSecond = await acquireFileLock(path, fast);
    releaseFirst();
    expect(existsSync(path)).toBe(true);
    releaseSecond();
    expect(existsSync(path)).toBe(false);
  });
});
