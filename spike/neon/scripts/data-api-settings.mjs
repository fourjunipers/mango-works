// Reads, and with --set changes, a project's Data API settings through Neon's API.
// Usage: node scripts/data-api-settings.mjs FREE|LAUNCH [--set]
// --set changes exactly three things and sends every other setting back as it was read
// (Neon: "The settings object replaces the existing settings entirely"):
//   db_schemas = public, platform; db_extra_search_path = public, extensions; db_max_rows = 1000
import { writeFileSync } from "node:fs";
import { neonApi, branchAndEndpoint } from "../lib/neon-api.mjs";

const which = process.argv[2];
if (!["FREE", "LAUNCH"].includes(which)) throw new Error("say FREE or LAUNCH");
const { branchId, branchName } = await branchAndEndpoint(which);
const path = `/branches/${branchId}/data-api/neondb`;

// Endpoint hostnames are not credentials, but they stay out of the saved files and the output.
const hideHost = (o) => JSON.parse(JSON.stringify(o ?? null).replace(/ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech/g, "<endpoint>"));
const before = hideHost(await neonApi(which, "GET", path));
console.log(which, "branch:", branchName, "| GET", before.status);
console.log(JSON.stringify(before.body, null, 1));
writeFileSync(new URL(`../results/data-api-settings-${which.toLowerCase()}-before.json`, import.meta.url), JSON.stringify(before.body, null, 2));
if (before.status !== 200 || !process.argv.includes("--set")) process.exit(before.status === 200 ? 0 : 1);

const current = before.body.settings ?? {};
const listLike = (sample, values) => (Array.isArray(sample) ? values : values.join(", "));
const settings = {
  ...current,
  db_schemas: listLike(current.db_schemas, ["public", "platform"]),
  // The API takes db_schemas as a list but db_extra_search_path as one string (a list is refused with HTTP 400).
  db_extra_search_path: "public, extensions",
  db_max_rows: 1000,
};
const patch = await neonApi(which, "PATCH", path, { settings });
console.log("PATCH", patch.status, JSON.stringify(patch.body).slice(0, 600));
const after = hideHost(await neonApi(which, "GET", path));
console.log("after:", JSON.stringify(after.body?.settings, null, 1));
writeFileSync(new URL(`../results/data-api-settings-${which.toLowerCase()}-after.json`, import.meta.url), JSON.stringify(after.body, null, 2));
