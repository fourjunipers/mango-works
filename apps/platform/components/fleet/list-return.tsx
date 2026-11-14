"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const scrollKey = (address: string) => `list-scroll:${address}`;

/**
 * Around Fleet or the Products list (owner, 14 Nov 2026). A link marked
 * `data-return` (the edit pencil, the name, "Add vehicle") already carries
 * `?back=` with the list's search, chips and sort, from the server. On a
 * plain click this adds the Fleet lines someone opened (`open=`; not those
 * open anyway, which keeps the address short), and
 * keeps the scroll position for this browser tab, so the back link on the
 * next page returns to the list as it was. A click with a modifier key (new
 * tab) uses the link as it is.
 */
export function ListReturn({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // Back on the list: where it was scrolled to, once.
  useEffect(() => {
    const address = search ? `${pathname}?${search}` : pathname;
    let y: number | null = null;
    try {
      const saved = sessionStorage.getItem(scrollKey(address));
      if (saved !== null) {
        sessionStorage.removeItem(scrollKey(address));
        y = Number(saved);
      }
    } catch {
      // No storage (private window): the list opens at the top.
    }
    if (y !== null && Number.isFinite(y)) {
      const top = y;
      requestAnimationFrame(() => window.scrollTo({ top }));
    }
  }, [pathname, search]);

  return (
    <div
      onClickCapture={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const link = (event.target as Element).closest<HTMLAnchorElement>(
          "a[data-return]",
        );
        if (!link) return;
        const here = new URL(window.location.href);
        here.searchParams.delete("open");
        const open = [
          ...document.querySelectorAll<HTMLElement>(
            "details[data-fleet-product][open]:not([data-default-open])",
          ),
        ]
          .map((line) => line.dataset.id)
          .filter(Boolean);
        if (open.length > 0) here.searchParams.set("open", open.join(","));
        const back = here.pathname + here.search;
        try {
          sessionStorage.setItem(scrollKey(back), String(window.scrollY));
        } catch {
          // No storage: the back link still keeps the view.
        }
        const target = new URL(link.href);
        target.searchParams.set("back", back);
        event.preventDefault();
        router.push(target.pathname + target.search);
      }}
    >
      {children}
    </div>
  );
}
