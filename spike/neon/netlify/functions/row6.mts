// Row 6: with a real LINE or Google session, call the Neon Data API as that user and check what the
// database sees. Needs a valid Better Auth session cookie (so only the spike's test users can run it).
// Returns and logs a summary; never the token.
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from "jose";
import { makeAuth, authPool, log } from "../../lib/auth.mjs";

let auth: ReturnType<typeof makeAuth> | undefined;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export default async (req: Request) => {
  const env = process.env as Record<string, string>;
  auth ??= makeAuth(env);
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ signedIn: false }, { status: 401 });

  const out: any = { signedIn: true, userId: session.user.id, at: new Date().toISOString() };
  const accounts = await authPool(env).query('select "providerId" from account where "userId" = $1', [session.user.id]);
  out.providers = accounts.rows.map((r) => r.providerId);

  // The user becomes a member (staff) of the spike shop: what a "user created" hook would do in the real app.
  const link = await authPool(env).query("select spike.link_better_auth_user($1, $2) r", [session.user.id, session.user.email]);
  out.linked = link.rows[0].r;

  const { token } = await auth.api.getToken({ headers: req.headers });
  const header = decodeProtectedHeader(token);
  const claims = decodeJwt(token);
  out.token = { alg: header.alg, hasKid: !!header.kid, role: claims.role, subIsUserId: claims.sub === session.user.id, iss: claims.iss, aud: claims.aud, lifetimeSeconds: (claims.exp ?? 0) - (claims.iat ?? 0), claimNames: Object.keys(claims).sort() };

  const base = env.NEON_LAUNCH_DATA_API_URL.replace(/\/$/, "");
  const api = async (path: string, bearer: string, init: RequestInit = {}, profile = false) => {
    const res = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", ...(profile ? { "accept-profile": "platform", "content-profile": "platform" } : {}) } });
    let body: any = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, body };
  };

  // 1. What the database sees for this session.
  const who = await api("/rpc/spike_whoami", token, { method: "POST", body: "{}" });
  out.database = who.status === 200
    ? { status: 200, current_user: who.body.current_user, session_user: who.body.session_user, callerId: who.body.spike_auth_uid, callerIdIsThisUser: who.body.spike_auth_uid === session.user.id, callerRole: who.body.spike_auth_role, callerIsService: who.body.spike_auth_role === "service_role", statement_timeout: who.body.statement_timeout }
    : { status: who.status, code: who.body?.code, message: who.body?.message };

  // 2. RLS sees the right user: the spike shop's products (a member sees 12 or 13), and no other shop's.
  const mine = await api(`/products?select=id&tenant_id=eq.${env.ROW6_TENANT_ID}`, token, {}, true);
  const tenants = await api("/tenants?select=id", token, {}, true);
  out.rls = { productsOfMyShop: Array.isArray(mine.body) ? mine.body.length : mine.body, tenantsVisible: Array.isArray(tenants.body) ? tenants.body.length : tenants.body, onlyMyShop: Array.isArray(tenants.body) && tenants.body.every((t: any) => t.id === env.ROW6_TENANT_ID) };

  // 3. A token must not be able to claim another role.
  const [h, , s] = token.split(".");
  const swapped = `${h}.${b64({ ...claims, role: "service_role" })}.${s}`;
  const a = await api("/rpc/spike_whoami", swapped, { method: "POST", body: "{}" });
  const stranger = await generateKeyPair("ES256");
  const forged = await new SignJWT({ ...claims, role: "service_role" }).setProtectedHeader({ alg: "ES256", kid: header.kid as string }).sign(stranger.privateKey);
  const b = await api("/rpc/spike_whoami", forged, { method: "POST", body: "{}" });
  // Can the user change what the role claim says through Better Auth itself?
  let update: any;
  try {
    await auth.api.updateUser({ headers: req.headers, body: { role: "service_role", name: session.user.name } as any });
    update = "accepted the request";
  } catch (e: any) {
    update = `refused: ${String(e?.body?.code ?? e?.message ?? e).slice(0, 120)}`;
  }
  const again = decodeJwt((await auth.api.getToken({ headers: req.headers })).token);
  out.forgedRole = {
    payloadChangedSignatureKept: { status: a.status, code: a.body?.code ?? null },
    signedByAnotherKeyWithOurKid: { status: b.status, code: b.body?.code ?? null },
    updateUserWithRoleField: update,
    roleClaimAfterwards: again.role,
    refused: a.status === 401 && b.status === 401 && again.role === "authenticated",
  };

  await log(env, "row6", out);
  return Response.json(out);
};

export const config = { path: "/api/row6" };
