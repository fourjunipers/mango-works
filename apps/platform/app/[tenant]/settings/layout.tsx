import { notFound } from "next/navigation";
import { canEnterSettings, settingsSectionsFor } from "@/lib/settings-access";
import { requireMembership } from "@/lib/session";
import { SettingsNav } from "./settings-nav";

/**
 * Every Settings page. Owners and managers (SPEC › Who uses it), and staff
 * for Settings › Extras alone, read-only (lib/settings-access.ts). Each
 * page checks its own access too; the menu shows a role only what it opens.
 */
export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/[tenant]/settings">) {
  const { tenant: slug } = await params;
  const { membership } = await requireMembership(slug);
  if (!canEnterSettings(membership.role)) notFound();
  return (
    <>
      <SettingsNav
        slug={slug}
        sections={[...settingsSectionsFor(membership.role)]}
      />
      {children}
    </>
  );
}
