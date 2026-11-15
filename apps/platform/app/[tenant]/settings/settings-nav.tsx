"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const sections = [
  { key: "shop", path: "" },
  { key: "pricing", path: "/pricing" },
  { key: "seasons", path: "/seasons" },
  { key: "priceLists", path: "/price-lists" },
] as const;

/**
 * Settings' sections (stage D6): the shop, Pricing and tax, Seasons and
 * Price lists. One row that scrolls sideways on a phone; the open section
 * is marked for screen readers too.
 */
export function SettingsNav({ slug }: { slug: string }) {
  const t = useTranslations("Settings.nav");
  const pathname = usePathname();
  const root = `/${slug}/settings`;
  const current = (path: string) =>
    path === ""
      ? pathname === root
      : pathname === root + path || pathname.startsWith(`${root}${path}/`);

  return (
    <nav aria-label={t("label")} className="-mx-4 mb-6 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b">
        {sections.map(({ key, path }) => (
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
        ))}
      </ul>
    </nav>
  );
}
