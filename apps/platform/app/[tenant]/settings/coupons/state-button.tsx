"use client";

import { useTranslations } from "next-intl";
import { ActionForm } from "@/components/action-form";
import { setCouponState } from "./actions";

export type StateChange = "on" | "off" | "archive" | "restore";

/**
 * One of a coupon's buttons: Switch off, Switch on, Archive, Bring back.
 * Archiving asks first: the code is then free for a new coupon.
 */
export function CouponStateButton({
  slug,
  id,
  code,
  change,
}: {
  slug: string;
  id: string;
  code: string;
  change: StateChange;
}) {
  const t = useTranslations("Settings.coupons");
  const label = {
    on: t("switchOn"),
    off: t("switchOff"),
    archive: t("archive"),
    restore: t("restore"),
  }[change];
  return (
    <ActionForm
      action={setCouponState}
      hidden={{ slug, id, code, change }}
      submitLabel={label}
      quiet
      confirm={change === "archive" ? t("archiveConfirm", { code }) : undefined}
      className="space-y-0"
    />
  );
}
