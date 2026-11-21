"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SettingsSection } from "@/lib/settings-access";
import { cn } from "@/lib/utils";

const paths: Record<SettingsSection, string> = {
  shop: "",
  pricing: "/pricing",
  seasons: "/seasons",
  priceLists: "/price-lists",
  coupons: "/coupons",
  extras: "/extras",
  bookingRules: "/booking-rules",
};

/**
 * Settings' sections (stage D6; Extras in Phase 2 stage 6, Coupons in
 * stage 9): the shop, Pricing and tax, Seasons, Price lists, Coupons and
 * Extras, as many as the role
 * opens. One row that scrolls sideways on a phone; the open section is
 * marked for screen readers too.
 */
export function SettingsNav({
  slug,
  sections,
}: {
  slug: string;
  sections: SettingsSection[];
}) {
  const t = useTranslations("Settings.nav");
  const pathname = usePathname();
  const root = `/${slug}/settings`;
  const current = (path: string) =>
    path === ""
      ? pathname === root
      : pathname === root + path || pathname.startsWith(`${root}${path}/`);
  // One section has no menu to choose from.
  if (sections.length < 2) return null;

  return (
    <nav aria-label={t("label")} className="-mx-4 mb-6 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b">
        {sections.map((key) => {
          const path = paths[key];
          return (
            <li key={key}>
              <Link
                href={root + path}
                aria-current={current(path) ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground",
                  current(path) && "border-primary text-foreground",
                )}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
