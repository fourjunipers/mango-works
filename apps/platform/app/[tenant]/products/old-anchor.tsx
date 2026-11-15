"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Sends an old link to a part of the page that has moved to another tab
 * there: a browser never sends the part after "#" to the server, so this is
 * done here. The Moto Mangos panel was on a product's Details tab
 * (…/products/[id]#moto-mangos) until it got its own tab. A link to one of
 * the panel's own places (#send-for-review) keeps it, so the tab opens there.
 */
export function OldAnchor({
  anchors,
  href,
}: {
  /** The ids that used to be on this tab. */
  anchors: string[];
  /** The tab they are on now. */
  href: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (!anchors.includes(anchor)) return;
    router.replace(anchor === anchors[0] ? href : `${href}#${anchor}`);
  }, [anchors, href, router]);
  return null;
}
