import { requireArea } from "@/lib/access";
import { SettingsNav } from "./settings-nav";

/** Every Settings page: owners and managers only (SPEC › Who uses it). */
export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/[tenant]/settings">) {
  const { tenant: slug } = await params;
  await requireArea(slug, "settings");
  return (
    <>
      <SettingsNav slug={slug} />
      {children}
    </>
  );
}
