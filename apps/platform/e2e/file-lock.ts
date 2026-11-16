import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * One holder at a time across processes: an exclusive lock file.
 *
 * The holder touches its file every few seconds while it holds the lock. A
 * file nobody has touched for `staleMs` was left by a run that was killed,
 * and the next one waiting takes it over. So a dead lock costs a waiting
 * test half a minute, far less than its timeout, however long a live
 * holder keeps the lock.
 */
export type FileLockOptions = {
  /** A lock not touched for this long is dead. */
  staleMs?: number;
  /** How often the holder touches its lock. Well under `staleMs`. */
  heartbeatMs?: number;
  /** How often a waiter looks again. */
  pollMs?: number;
};

export const LOCK_STALE_MS = 30_000;
export const LOCK_HEARTBEAT_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the lock at `path`, takes it, and returns its release. */
export async function acquireFileLock(
  path: string,
  {
    staleMs = LOCK_STALE_MS,
    heartbeatMs = LOCK_HEARTBEAT_MS,
    pollMs = 250,
  }: FileLockOptions = {},
): Promise<() => void> {
  const token = `${process.pid} ${randomUUID()}`;
  const ours = () => {
    try {
      return readFileSync(path, "utf8") === token;
    } catch {
      return false;
    }
  };
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, token);
      closeSync(fd);
      const beat = setInterval(() => {
        // Taken over (this process stalled past staleMs): leave it alone.
        if (!ours()) return clearInterval(beat);
        try {
          const now = new Date();
          utimesSync(path, now, now);
        } catch {
          // Gone: nothing to keep alive.
        }
      }, heartbeatMs);
      // Never keeps a finished process running.
      beat.unref();
      return () => {
        clearInterval(beat);
        if (!ours()) return;
        try {
          unlinkSync(path);
        } catch {
          // Already gone.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > staleMs) {
          // Moved aside first: of several waiters only one rename succeeds.
          const aside = `${path}.${randomUUID()}.stale`;
          renameSync(path, aside);
          unlinkSync(aside);
          continue;
        }
      } catch {
        // Released, or taken over by another waiter, meanwhile.
      }
      await sleep(pollMs);
    }
  }
}
