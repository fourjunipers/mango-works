import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/session";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * The old address of a product's page (before 13 Nov 2026): kept as a
 * redirect. Membership first (a shop the visitor isn't in is a 404, as
 * everywhere); the id must be an id; then on to a path built from the shop
 * that check answered with.
 */
export default async function OldModelPage({
  params,
}: PageProps<"/[tenant]/fleet/models/[id]">) {
  const { tenant: slug, id } = await params;
  const { membership } = await requireMembership(slug);
  if (!UUID.test(id)) notFound();
  redirect(
    `/${encodeURIComponent(membership.tenant.slug)}/products/${id.toLowerCase()}`,
  );
}
