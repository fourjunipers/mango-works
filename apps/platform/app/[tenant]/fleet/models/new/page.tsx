import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { requireMembership } from "@/lib/session";

/**
 * The old address of "New product" (before 13 Nov 2026): kept as a redirect.
 * Membership first (a shop the visitor isn't in is a 404, as everywhere),
 * then on to a path built from the shop that check answered with.
 */
export default async function OldNewModelPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/fleet/models/new">) {
  const [{ tenant: slug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireMembership(slug);
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (typeof value === "string") kept.set(key, value);
  const suffix = kept.size > 0 ? `?${kept}` : "";
  const home = `/${encodeURIComponent(membership.tenant.slug)}/products/new`;
  redirect(safeNextPath(`${home}${suffix}`, home));
}
