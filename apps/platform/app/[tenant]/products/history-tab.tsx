import { seasonHistory } from "@/lib/season-history";
import { percentLabel, seasonDates } from "@/lib/seasons";
import { getTranslations } from "next-intl/server";
import { Panel } from "@/components/action-form";
import {
  getGearUnitAudit,
  getMemberNames,
  getProductHistory,
} from "@/lib/fleet-data";
import { formatDay } from "@/lib/general-products";
import {
  buildHistory,
  gearStockActions,
  gearUnitHistory,
  historyValue,
} from "@/lib/history";
import { formatMinor, multiplierText } from "@/lib/money";
import {
  getPricingAudit,
  getSeasonAudit,
  getTaxProfileNames,
  getTemplateNames,
} from "@/lib/pricing-data";
import {
  pricingHistory,
  templatesFromAudit,
  type PricingArg,
  type PricingEntry,
} from "@/lib/pricing-history";
import { getProductNames } from "@/lib/extras-data";
import { extrasHistory, extrasNamed } from "@/lib/extras-history";
import { formatInstant } from "@/lib/shop-time";
import { humanizeKey } from "@/lib/vehicle-kinds";
import { ExtrasHistoryItem, extrasWords } from "./extras-history";

/**
 * Who changed what on a product and its units, newest first (owners and
 * managers: the audit log's own rule). A vehicle product names its vehicles
 * by plate. Tracked gear names its units by label and says what was done to
 * each in the words of the buttons ("marked 1 in repair", "wrote off 1 as
 * damaged"), with the unit's label, the day it happened and its notes; a
 * unit that was written off keeps its lines.
 */
export async function HistoryTab({
  tenantId,
  productId,
  units,
  unitsAre,
  trackedGear,
  timezone,
  currency,
  locale,
}: {
  tenantId: string;
  productId: string;
  /** The units whose own changes belong in this history, with a name each. */
  units: { id: string; name: string | null }[];
  unitsAre: "vehicles" | "gear";
  /** Gear tracked unit by unit: each unit's own lines are added. */
  trackedGear?: boolean;
  timezone: string;
  /** The shop's currency: price lines show amounts in it. */
  currency: string;
  locale: string;
}) {
  const limit = 100;
  const [
    t,
    tFleet,
    productRows,
    names,
    unitRows,
    pricingRows,
    templateNames,
    taxNames,
    seasonRows,
  ] = await Promise.all([
    getTranslations("Products.history"),
    getTranslations("Fleet"),
    getProductHistory(
      tenantId,
      productId,
      units.map((unit) => unit.id),
      limit,
    ),
    getMemberNames(tenantId),
    trackedGear ? getGearUnitAudit(tenantId, productId, limit) : [],
    getPricingAudit(tenantId, productId, limit),
    getTemplateNames(tenantId),
    getTaxProfileNames(tenantId),
    getSeasonAudit(tenantId),
  ]);
  // Price lines (lib/pricing-history.ts): the product's pricing rows and
  // pricing_change events, its own lists and the shared lists it is on.
  const templates = new Map([
    ...templatesFromAudit(pricingRows),
    ...templateNames,
  ]);
  const priceEntries = [
    ...pricingHistory([...productRows, ...pricingRows], productId, templates),
    // Seasons that cover it (lib/season-history.ts).
    ...seasonHistory(seasonRows, productId),
  ];
  const gear = gearUnitHistory(unitRows);
  // A stock function's own line says what a unit's rows of the same moment
  // would say again. A label's change stays.
  const said = new Set(
    productRows
      .filter((row) => gearStockActions.has(row.action))
      .map((row) => row.at),
  );
  const rows = [
    ...productRows,
    ...gear.rows.filter((row) => row.action === "update" || !said.has(row.at)),
  ]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .slice(0, limit);
  const entries = buildHistory(rows);
  // The extras offered with it (lib/extras-history.ts): one line a save.
  // A product deleted since is named from its own delete event.
  const extrasEntries = extrasHistory(productRows);
  const extrasSay = await extrasWords(
    await getProductNames(tenantId, extrasNamed(extrasEntries)),
  );
  // Both kinds of line, newest first, the latest `limit` of them.
  const timeline = [
    ...entries.map((entry) => ({
      at: entry.at,
      id: entry.id,
      entry,
      price: null,
      extras: null,
    })),
    ...priceEntries.map((price) => ({
      at: price.at,
      id: price.rowId,
      entry: null,
      price,
      extras: null,
    })),
    ...extrasEntries.map((extras) => ({
      at: extras.at,
      id: extras.id,
      entry: null,
      price: null,
      extras,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .slice(0, limit);
  const tp = await getTranslations("Products.history.pricing");
  const arg = (value: PricingArg, name: string): string | number => {
    if ("money" in value)
      return value.money ? formatMinor(value.money, currency, locale) : "";
    if ("multiplier" in value)
      return value.multiplier ? `×${multiplierText(value.multiplier)}` : "";
    if ("number" in value) return value.number;
    if ("adjust" in value)
      return tp(value.adjust < 0 ? "seasonOff" : "seasonMore", {
        percent: percentLabel(value.adjust, locale),
      });
    if ("dates" in value)
      return tp(value.dates.yearly ? "seasonYearly" : "seasonOnce", {
        ...seasonDates(
          value.dates.startsOn,
          value.dates.endsOn,
          value.dates.yearly,
          locale,
        ),
      });
    if ("method" in value)
      return value.method ? tp(`method.${value.method}`) : tp("method.none");
    if ("period" in value) return tp(`period.${value.period}`);
    if ("tax" in value)
      return value.tax === "default"
        ? tp("tax.default")
        : value.tax === "none"
          ? tp("tax.none")
          : (taxNames.get(value.tax) ?? tp("tax.removed"));
    // A quick-entry box is named in words; a list's name is shown as it is.
    if (name === "box") return tp(`box.${value.text}` as "box.daily");
    return value.text;
  };
  const priceWords = (args: PricingEntry["line"]["args"]) =>
    Object.fromEntries(
      Object.entries(args).map(([name, value]) => [name, arg(value, name)]),
    );
  const unnamed = unitsAre === "vehicles" ? tFleet("noPlate") : t("unlabelled");
  const unitNames = new Map([
    ...[...gear.names].map(([id, name]) => [id, name ?? unnamed] as const),
    ...units.map((unit) => [unit.id, unit.name ?? unnamed] as const),
  ]);
  const words = { empty: t("empty"), yes: t("yes"), no: t("no") };
  // A stored day reads as a date; anything else as it is.
  const value = (stored: unknown) =>
    typeof stored === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored)
      ? formatDay(stored, locale)
      : historyValue(stored, words);
  const fieldLabel = (field: string) =>
    t.has(`field.${field}` as "field.name")
      ? t(`field.${field}` as "field.name")
      : humanizeKey(field);
  const what = (entity: string, entityId: string) =>
    entity === "units"
      ? t(unitsAre === "vehicles" ? "on.units" : "on.gearUnits", {
          name: unitNames.get(entityId) ?? unnamed,
        })
      : t("on.products");

  return (
    <Panel
      intro={t(unitsAre === "vehicles" ? "intro" : "introGeneral")}
      className="max-w-3xl"
    >
      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ol className="divide-y rounded-md border">
          {timeline.map((item) => {
            if (item.extras) {
              const extras = item.extras;
              const who =
                extras.actor === null
                  ? t("system")
                  : (names.get(extras.actor) ?? t("formerMember"));
              const { line, sub } = extrasSay(extras, who);
              return (
                <ExtrasHistoryItem
                  key={`extras-${extras.id}`}
                  line={line}
                  sub={sub}
                  at={extras.at}
                  timezone={timezone}
                  locale={locale}
                />
              );
            }
            if (item.price) {
              const price = item.price;
              const who =
                price.actor === null
                  ? t("system")
                  : (names.get(price.actor) ?? t("formerMember"));
              return (
                <li key={`price-${price.key}`} className="p-3 text-sm">
                  <p className="font-medium">
                    {tp(`line.${price.line.key}` as "line.depositSet", {
                      who,
                      ...priceWords(price.line.args),
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={price.at}>
                      {formatInstant(new Date(price.at), timezone, locale)}
                    </time>
                  </p>
                  {price.line.sub && (
                    <ul className="mt-2 space-y-1">
                      {price.line.sub.map((sub, i) => (
                        <li key={i}>
                          {tp(`line.${sub.key}` as "line.otherDays", {
                            ...priceWords(sub.args),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            }
            const entry = item.entry!;
            const who =
              entry.actor === null
                ? t("system")
                : (names.get(entry.actor) ?? t("formerMember"));
            const subject = what(entry.entity, entry.entityId);
            const line = t.has(`action.${entry.action}` as "action.insert")
              ? t(`action.${entry.action}` as "action.insert", {
                  who,
                  what: subject,
                  count: entry.quantity ?? 0,
                  from: entry.leadTime?.from ?? 0,
                  to: entry.leadTime?.to ?? 0,
                })
              : t("action.other", {
                  who,
                  action: entry.action,
                  what: subject,
                });
            return (
              <li key={entry.id} className="p-3 text-sm">
                <p className="font-medium">{line}</p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.at}>
                    {formatInstant(new Date(entry.at), timezone, locale)}
                  </time>
                </p>
                {entry.details && (
                  <ul className="mt-2 space-y-1">
                    {entry.details.labels && (
                      <li>
                        {t("detail.units", {
                          names: entry.details.labels.join(", "),
                        })}
                      </li>
                    )}
                    {entry.details.happenedOn && (
                      <li>
                        {t("detail.happenedOn", {
                          date: formatDay(entry.details.happenedOn, locale),
                        })}
                      </li>
                    )}
                    {entry.details.expectedBack && (
                      <li>
                        {t("detail.expectedBack", {
                          date: formatDay(entry.details.expectedBack, locale),
                        })}
                      </li>
                    )}
                    {entry.details.notes && (
                      <li className="whitespace-pre-line">
                        {t("detail.notes", { notes: entry.details.notes })}
                      </li>
                    )}
                  </ul>
                )}
                {entry.changes.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {entry.changes.map((change) => (
                      <li key={change.field}>
                        {t("change", {
                          field: fieldLabel(change.field),
                          from: value(change.from),
                          to: value(change.to),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {rows.length >= limit && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("latest", { count: limit })}
        </p>
      )}
    </Panel>
  );
}
