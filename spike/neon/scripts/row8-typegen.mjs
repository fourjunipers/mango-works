// Row 8, type generation: run the repo's existing generator (the Supabase CLI, already a root devDependency)
// against Neon by address, and compare what it writes with packages/db/src/database.types.ts.
// Usage: node scripts/row8-typegen.mjs launch
// The connection string is passed to the CLI in its environment-expanded argument; it is never printed.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { need, safe } from "../lib/env.mjs";

const which = (process.argv[2] ?? "launch").toUpperCase();
const here = dirname(fileURLToPath(import.meta.url));
const mainCheckout = resolve(here, "..", "..", "..", "..", "..", "..");
const cli = resolve(mainCheckout, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe");
if (!existsSync(cli)) throw new Error("the Supabase CLI binary is not installed in the main checkout");

const t0 = Date.now();
const r = spawnSync(cli, ["gen", "types", "typescript", // The CLI's driver passes channel_binding on to the server as a setting and is refused; drop it from the address.
  "--db-url", need(`NEON_${which}_DIRECT_URL`).replace(/&channel_binding=[^&]*/, ""), "--schema", "public,platform"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 280_000 });
const out = { target: which.toLowerCase(), cliVersion: spawnSync(cli, ["--version"], { encoding: "utf8" }).stdout.trim(), exitCode: r.status, seconds: Math.round((Date.now() - t0) / 1000) };
if (r.status !== 0) {
  out.error = safe(((r.stderr || "") + " | " + (r.stdout || "").slice(-600) + " | " + (r.error?.message || "")).slice(-1500)).replace(/ep-[a-z0-9-]+[.][a-z0-9.-]+[.]neon[.]tech/g, "<endpoint>");
} else {
  const generated = r.stdout;
  writeFileSync(new URL("../results/row8-neon-database.types.ts.txt", import.meta.url), generated);
  const repo = readFileSync(resolve(here, "..", "..", "..", "packages", "db", "src", "database.types.ts"), "utf8");
  const names = (src, schema, kind) => {
    const m = new RegExp(`\\n  ${schema}: \\{[\\s\\S]*?\\n    ${kind}: \\{([\\s\\S]*?)\\n    \\}`).exec(src);
    return m ? [...m[1].matchAll(/\n      ([a-z_0-9]+): /g)].map((x) => x[1]).sort() : [];
  };
  out.lines = { generatedFromNeon: generated.split("\n").length, repoFile: repo.split("\n").length };
  out.compare = {};
  for (const schema of ["public", "platform"]) {
    for (const kind of ["Tables", "Views", "Functions", "Enums"]) {
      const a = names(repo, schema, kind);
      const b = names(generated, schema, kind);
      out.compare[`${schema}.${kind}`] = { repo: a.length, neon: b.length, onlyInRepo: a.filter((x) => !b.includes(x)), onlyInNeon: b.filter((x) => !a.includes(x)) };
    }
  }
  out.identicalText = generated.trim() === repo.trim();
}
writeFileSync(new URL("../results/row8-typegen.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
