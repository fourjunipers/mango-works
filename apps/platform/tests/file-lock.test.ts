import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
/**
 * For the tests that a live holder keeps its lock. The holder's heartbeat
 * and the waiter share this process, so a busy machine that stalls it for
 * longer than `staleMs` minus `heartbeatMs` would let the waiter take a live
 * lock. A stale time well beyond any such stall; the heartbeat as before.
 */
const live = { staleMs: 1_000, heartbeatMs: 50, pollMs: 20 };

/**
 * Each test takes well under a second on an idle machine (the liveness test
 * three). On a busy one this process can be starved for seconds (a takeover
 * that needs 300 ms took 1.3 s with every core busy): a timeout sized for
 * that, not the 5-second default.
 */
vi.setConfig({ testTimeout: 30_000 });

describe("the browser tests' lock file", () => {
  it("is held by one at a time, and handed on at release", async () => {
    const release = await acquireFileLock(path, live);
    let second = false;
    const waiting = acquireFileLock(path, live).then((r) => {
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
    const release = await acquireFileLock(path, live);
    let second = false;
    const waiting = acquireFileLock(path, live).then((r) => {
      second = true;
      return r;
    });
    // Three times the stale time: the heartbeat keeps it alive.
    await sleep(3 * live.staleMs);
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
    // Measured from the file's own time, as the lock measures it: a clock
    // read after the write starts late whenever the process is paused in
    // between (once 75 ms late on a busy machine).
    const touched = statSync(path).mtimeMs;
    const release = await acquireFileLock(path, fast);
    const waited = Date.now() - touched;
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
