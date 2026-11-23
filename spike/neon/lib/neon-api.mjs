// Neon's management API, with the two project-scoped keys from .env. Never prints a key.
import { need, safe } from "./env.mjs";

const BASE = "https://console.neon.tech/api/v2";

/** which: "FREE" | "LAUNCH". Returns { status, body }. */
export async function neonApi(which, method, path, body) {
  const res = await fetch(`${BASE}/projects/${need(`NEON_${which}_PROJECT_ID`)}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${need(`NEON_${which}_API_KEY`)}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = safe(text).slice(0, 500);
  }
  return { status: res.status, body: parsed };
}

/** The project's default branch id and its read-write endpoint id. */
export async function branchAndEndpoint(which) {
  const b = await neonApi(which, "GET", "/branches");
  if (b.status !== 200) throw new Error(`list branches: HTTP ${b.status} ${safe(JSON.stringify(b.body)).slice(0, 300)}`);
  const branch = b.body.branches.find((x) => x.default) ?? b.body.branches[0];
  const e = await neonApi(which, "GET", `/branches/${branch.id}/endpoints`);
  if (e.status !== 200) throw new Error(`list endpoints: HTTP ${e.status}`);
  const endpoint = e.body.endpoints.find((x) => x.type === "read_write") ?? e.body.endpoints[0];
  return { branchId: branch.id, branchName: branch.name, endpointId: endpoint.id, endpoint };
}
