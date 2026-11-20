import { getTranslations } from "next-intl/server";
import type { ExtrasChange, ExtrasEntry } from "@/lib/extras-history";
import { formatInstant } from "@/lib/shop-time";

type Names = Map<string, { name: string; deleted: boolean }>;

/**
 * The words of one extras_change event (lib/extras-history.ts): one line
 * when the save did one thing ("Ann added Helmet: 2 included, most 4 per
 * vehicle"), else "Ann changed the extras" with what changed under it.
 * A product deleted since keeps the name its delete event kept.
 */
export async function extrasWords(names: Names) {
  const t = await getTranslations("Products.history.extras");
  const name = (id: string) => {
    const known = names.get(id);
    if (!known) return t("removedProduct");
    return known.deleted ? t("deletedName", { name: known.name }) : known.name;
  };
  const most = (value: number | null) =>
    value === null ? t("noLimit") : String(value);
  const say = (change: ExtrasChange): string => {
    switch (change.kind) {
      case "added":
        return change.most === null
          ? t("added", { name: name(change.extra), included: change.included })
          : t("addedMost", {
              name: name(change.extra),
              included: change.included,
              most: change.most,
            });
      case "removed":
        return t("removed", { name: name(change.extra) });
      case "notOffered":
        return t("notOffered", { name: name(change.extra) });
      case "offeredAgain":
        return t("offeredAgain", { name: name(change.extra) });
      case "reordered":
        return t("reordered");
      case "changed":
        return [
          change.included &&
            t("includedChanged", {
              name: name(change.extra),
              from: change.included.from,
              to: change.included.to,
            }),
          change.most &&
            t("mostChanged", {
              name: name(change.extra),
              from: most(change.most.from),
              to: most(change.most.to),
            }),
        ]
          .filter(Boolean)
          .join(" ");
    }
  };
  /** The entry's headline and, when it did several things, the list under it. */
  return (entry: ExtrasEntry, who: string) => {
    const every = entry.list === "every_vehicle";
    if (entry.changes.length === 1)
      return {
        line: t(every ? "oneEvery" : "one", {
          who,
          what: say(entry.changes[0]),
        }),
        sub: [] as string[],
      };
    return {
      line: t(every ? "manyEvery" : "many", { who }),
      sub: entry.changes.map(say),
    };
  };
}

/** One extras line of a History list. */
export function ExtrasHistoryItem({
  line,
  sub,
  at,
  timezone,
  locale,
}: {
  line: string;
  sub: string[];
  at: string;
  timezone: string;
  locale: string;
}) {
  return (
    <li className="p-3 text-sm" data-history="extras">
      <p className="font-medium">{line}</p>
      <p className="text-xs text-muted-foreground">
        <time dateTime={at}>
          {formatInstant(new Date(at), timezone, locale)}
        </time>
      </p>
      {sub.length > 0 && (
        <ul className="mt-2 space-y-1">
          {sub.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
