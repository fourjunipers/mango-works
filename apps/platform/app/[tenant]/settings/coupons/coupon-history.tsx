import { getLocale, getTranslations } from "next-intl/server";
import { Panel } from "@/components/action-form";
import type { CouponChange, CouponValue } from "@/lib/coupon-history";
import { couponHistory } from "@/lib/coupon-history";
import { dayText } from "@/lib/coupon-words";
import { getCouponAudit } from "@/lib/coupons-data";
import { getMemberNames } from "@/lib/fleet-data";
import { formatMinor } from "@/lib/money";
import { percentLabel } from "@/lib/seasons";
import { formatInstant } from "@/lib/shop-time";

/**
 * Coupon History (Phase 2 stage 9): every change in the buttons' words, one
 * action a line ("Ann switched off SUMMER10"), newest first, in the History
 * style of the extras and the seasons. Owners and managers: the audit log's
 * rule. The whole shop's coupons on the list page, one coupon on its page.
 */
export async function CouponHistory({
  tenantId,
  timezone,
  currency,
  couponId,
  limit = 50,
}: {
  tenantId: string;
  timezone: string;
  currency: string;
  couponId?: string;
  limit?: number;
}) {
  const [t, tHistory, locale, rows, members] = await Promise.all([
    getTranslations("Settings.coupons.history"),
    getTranslations("Products.history"),
    getLocale(),
    getCouponAudit(tenantId, couponId),
    getMemberNames(tenantId),
  ]);
  const lines = couponHistory(rows).slice(0, limit);
  const value = (v: CouponValue | null) =>
    v === null
      ? t("noValue")
      : v.kind === "percent"
        ? t("percentOff", { percent: percentLabel(v.bp, locale) })
        : t("amountOff", { amount: formatMinor(v.amount, currency, locale) });
  const range = (from: string | null, to: string | null) =>
    from && to
      ? t("between", { from: dayText(from, locale), to: dayText(to, locale) })
      : from
        ? t("fromDay", { from: dayText(from, locale) })
        : to
          ? t("untilDay", { to: dayText(to, locale) })
          : t("anyDay");
  const say = (change: CouponChange, code: string, who: string): string => {
    const base = { who, code };
    switch (change.kind) {
      case "created":
        return t(change.allProducts ? "created" : "createdChosen", {
          ...base,
          value: value(change.value),
          count: change.products,
        });
      case "switchedOn":
      case "switchedOff":
      case "archived":
      case "restored":
      case "allProducts":
        return t(change.kind, base);
      case "codeChanged":
        return t("codeChanged", { who, from: change.from, to: change.to });
      case "renamed":
        return change.to
          ? t("renamed", { ...base, name: change.to })
          : t("nameCleared", base);
      case "valueChanged":
        return t("valueChanged", {
          ...base,
          from: value(change.from),
          to: value(change.to),
        });
      case "chosenProducts":
        return t("chosenProducts", { ...base, count: change.count });
      case "validDates":
        return t("validDates", {
          ...base,
          range: range(change.from, change.to),
        });
      case "pickupDates":
        return t("pickupDates", {
          ...base,
          range: range(change.from, change.to),
        });
      case "minDays":
        return change.to === null
          ? t("minDaysCleared", base)
          : t("minDays", { ...base, days: change.to });
      case "minSpend":
        return change.to === null
          ? t("minSpendCleared", base)
          : t("minSpend", {
              ...base,
              amount: formatMinor(change.to, currency, locale),
            });
      case "maxUses":
        return change.to === null
          ? t("maxUsesCleared", base)
          : t("maxUses", { ...base, uses: change.to });
      case "channels":
        return change.to.length === 0
          ? t("channelsNone", base)
          : t("channels", {
              ...base,
              channels: change.to
                .map((c) =>
                  t(`channel_${c as "staff" | "booking_page" | "marketplace"}`),
                )
                .join(", "),
            });
      case "withReturning":
        return t(change.on ? "withReturningOn" : "withReturningOff", base);
      case "withSeason":
        return t(change.on ? "withSeasonOn" : "withSeasonOff", base);
    }
  };

  return (
    <Panel title={t("title")} className="max-w-3xl">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tHistory("none")}</p>
      ) : (
        <ol className="divide-y rounded-md border">
          {lines.map((line) => {
            const who =
              line.actor === null
                ? tHistory("system")
                : (members.get(line.actor) ?? tHistory("formerMember"));
            return (
              <li key={line.key} className="p-3 text-sm" data-history="coupon">
                <p className="font-medium">
                  {say(line.change, line.code, who)}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={line.at}>
                    {formatInstant(new Date(line.at), timezone, locale)}
                  </time>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
