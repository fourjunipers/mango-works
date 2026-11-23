// Row 6: Better Auth's own handler (sign-in, OAuth callbacks, session, /token, /jwks).
// This one cannot sit behind the spike's secret header: LINE and Google redirect the browser here.
// Who can get a session is limited by the providers: the LINE channel is "Developing" (admin and testers
// only) and the Google client is in "Testing" (listed test users only). Email-and-password is off.
import { makeAuth } from "../../lib/auth.mjs";

let auth: ReturnType<typeof makeAuth> | undefined;

export default async (req: Request) => {
  auth ??= makeAuth(process.env as Record<string, string>);
  return auth.handler(req);
};

export const config = { path: "/api/auth/*" };
