import pg from "pg";
import { need, safe } from "./env.mjs";

/** One direct or pooled connection to a Neon project. which: "FREE" | "LAUNCH"; kind: "DIRECT" | "POOLED". */
export async function neon(which, kind = "DIRECT", extra = {}) {
  const client = new pg.Client({ connectionString: need(`NEON_${which}_${kind}_URL`).replace("sslmode=require", "sslmode=verify-full"), application_name: "neon-spike", ...extra });
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`could not connect to Neon ${which} ${kind}: ${safe(e.message)}`);
  }
  return client;
}

/** Runs fn inside a transaction that is always rolled back. */
export async function rolledBack(client, fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}
