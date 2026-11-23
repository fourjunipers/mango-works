// Row 6: Better Auth, run in the app (here: in the throwaway site's function), with LINE and Google.
// One config, used by the Netlify function and by the local migration script.
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { decodeProtectedHeader, decodeJwt, jwtVerify } from "jose";
import pg from "pg";

let pool;
export function authPool(env) {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL.replace("sslmode=require", "sslmode=verify-full"), max: 2, idleTimeoutMillis: 10_000 });
    pool.on("error", () => {});
  }
  return pool;
}

/** A line in the spike's own log table (no tokens, no secrets). */
export async function log(env, kind, detail) {
  try {
    await authPool(env).query("insert into spike_log (kind, detail) values ($1, $2)", [kind, JSON.stringify(detail)]);
  } catch {}
}

export function makeAuth(env) {
  const base = env.BETTER_AUTH_URL;
  return betterAuth({
    baseURL: base,
    secret: env.BETTER_AUTH_SECRET,
    database: authPool(env),
    // uuid ids, so a user's id can be the `sub` our "who is calling" function reads as a uuid.
    advanced: { database: { generateId: "uuid" } },
    // No email-and-password sign-up on the spike: only LINE and Google, and both are limited to test users.
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      line: {
        clientId: env.LINE_CHANNEL_ID,
        clientSecret: env.LINE_CHANNEL_SECRET,
        // The channel has no email permission (it needs an application to LINE), so ask for openid and profile only.
        disableDefaultScope: true,
        scope: ["openid", "profile"],
        // Better Auth 1.7.27 only DECODES the ID token it gets from LINE's token endpoint; it does not check the
        // signature. LINE signs web-login ID tokens with HS256 and the channel secret (the case that broke OIDC
        // on Supabase). So the spike checks it here itself, and refuses the sign-in if the check fails.
        getUserInfo: async (token) => {
          if (!token.idToken) {
            await log(env, "line_id_token", { present: false });
            return null;
          }
          const header = decodeProtectedHeader(token.idToken);
          let verified = false;
          let failure = null;
          try {
            await jwtVerify(token.idToken, new TextEncoder().encode(env.LINE_CHANNEL_SECRET), {
              algorithms: ["HS256"],
              issuer: "https://access.line.me",
              audience: env.LINE_CHANNEL_ID,
            });
            verified = true;
          } catch (e) {
            failure = String(e?.code ?? e?.message ?? e);
          }
          const profile = decodeJwt(token.idToken);
          await log(env, "line_id_token", { present: true, alg: header.alg, hasKid: !!header.kid, verifiedWithChannelSecret: verified, failure, hasEmail: !!profile.email, claims: Object.keys(profile).sort() });
          if (!verified) return null;
          return {
            user: {
              id: profile.sub,
              name: profile.name || "",
              // No email from LINE without the permission: a placeholder that can never be a real address.
              email: profile.email ?? `${profile.sub}@line.spike.invalid`,
              image: profile.picture,
              emailVerified: false,
            },
            data: profile,
          };
        },
      },
    },
    plugins: [
      jwt({
        // ES256: the Data API's public source accepts RS256 and ES256 only (Better Auth's default is EdDSA).
        jwks: { keyPairConfig: { alg: "ES256" } },
        jwt: {
          issuer: base,
          audience: base,
          expirationTime: "15m",
          // The role is a constant. Nothing a user can change reaches this claim.
          definePayload: ({ user }) => ({ role: "authenticated", email: user.email }),
        },
      }),
    ],
  });
}
