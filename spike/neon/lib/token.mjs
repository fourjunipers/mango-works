// Signs short-lived tokens with the spike's own ES256 key (.env.spike). The Data API checks them against
// the public JWKS file on the draft deploy.
import { SignJWT, importJWK } from "jose";

let cached;
async function key(privateJwkJson) {
  if (!cached) {
    const jwk = JSON.parse(privateJwkJson);
    cached = { key: await importJWK(jwk, "ES256"), kid: jwk.kid };
  }
  return cached;
}

/** claims: e.g. { sub, role: "authenticated" }. ttl in seconds. */
export async function sign(privateJwkJson, claims, ttl = 900) {
  const { key: k, kid } = await key(privateJwkJson);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(k);
}
