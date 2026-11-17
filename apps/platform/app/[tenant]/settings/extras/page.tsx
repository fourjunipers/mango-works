import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Panel } from "@/components/action-form";
import { PageHeader } from "@/components/page";
import { getExtrasAudit, getProductNames } from "@/lib/extras-data";
import { extrasHistory, extrasNamed } from "@/lib/extras-history";
import { getMemberNames } from "@/lib/fleet-data";
import { canSeeArea } from "@/lib/roles";
import { requireMembership } from "@/lib/session";
import { canSeeExtrasSettings } from "@/lib/settings-access";
import { ExtrasHistoryItem, extrasWords } from "../../products/extras-history";
import { ExtrasPanel } from "../../products/extras-tab";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.extras");
  return { title: t("title") };
}

/**
 * Settings › Extras (docs/phase-2-plan.md §7): the gear and services
 * offered with every vehicle of the shop. Owners and managers edit; staff
 * read, with no edit controls. Each vehicle's own list, and its "Not
 * offered for this vehicle" switches, are on its Extras tab. Owners and
 * managers see who changed this list (the audit log's rule).
 */
export default async function ExtrasSettingsPage({
  params,
}: PageProps<"/[tenant]/settings/extras">) {
  const { tenant: slug } = await params;
  const { membership } = await requireMembership(slug);
  const { tenant, role } = membership;
  if (!canSeeExtrasSettings(role)) notFound();
  const t = await getTranslations("Settings.extras");
  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <div className="space-y-6">
        <ExtrasPanel
          slug={slug}
          tenantId={tenant.id}
          role={role}
          productId={null}
        />
        {canSeeArea(role, "settings") && (
          <EveryVehicleHistory tenantId={tenant.id} timezone={tenant.timezone} />
        )}
      </div>
    </>
  );
}

async function EveryVehicleHistory({
  tenantId,
  timezone,
}: {
  tenantId: string;
  timezone: string;
}) {
  const limit = 50;
  const [t, locale, rows, members] = await Promise.all([
    getTranslations("Products.history"),
    getLocale(),
    getExtrasAudit(tenantId, "every_vehicle", limit),
    getMemberNames(tenantId),
  ]);
  const entries = extrasHistory(rows);
  const words = await extrasWords(
    await getProductNames(tenantId, extrasNamed(entries)),
  );
  return (
    <Panel title={t("extras.everyTitle")} className="max-w-3xl">
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ol className="divide-y rounded-md border">
          {entries.map((entry) => {
            const who =
              entry.actor === null
                ? t("system")
                : (members.get(entry.actor) ?? t("formerMember"));
            const { line, sub } = words(entry, who);
            return (
              <ExtrasHistoryItem
                key={entry.id}
                line={line}
                sub={sub}
                at={entry.at}
                timezone={timezone}
                locale={locale}
              />
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
