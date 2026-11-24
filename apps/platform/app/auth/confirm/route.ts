import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@mango/db/platform-server";

/**
 * Email sign-in links land here in one of two shapes:
 * - `token_hash` + `type`, from a custom email template. Verified on the
 *   server, so it works in any browser.
 * - `code`, from Supabase's default template (used until branded emails
 *   arrive). A PKCE code, so it only works in the browser that asked for it.
 */
/**
 * The one-time-code types this route verifies: a sign-in link by email, under
 * either name Supabase gives it. Every other type (recovery, invite,
 * email_change, signup, the phone ones) is refused before Supabase is asked:
 * neither app offers those flows, so a link naming one was not made here.
 */
const LINK_TYPES = ["email", "magiclink"] as const satisfies EmailOtpType[];

function emailLinkType(value: string | null) {
  return LINK_TYPES.find((type) => type === value) ?? null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = emailLinkType(searchParams.get("type"));
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (ok) return NextResponse.redirect(new URL(next, origin));

  const login = new URL("/login", origin);
  login.searchParams.set("error", "link");
  login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}
