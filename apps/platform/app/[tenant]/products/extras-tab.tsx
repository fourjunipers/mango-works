import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Panel } from "@/components/action-form";
import { canExtras } from "@/lib/extras-permissions";
import { getExtrasScreen } from "@/lib/extras-data";
import { draftsOf, shopWideState, type SavedExtra } from "@/lib/extras";
import { canPricing } from "@/lib/pricing-permissions";
import type { Role } from "@/lib/roles";
import { canSeeExtrasSettings } from "@/lib/settings-access";
import {
  ExtrasEditor,
  ProductName,
  Quantities,
  type EditorProduct,
} from "./extras-editor";

/**
 * The gear and services offered with a vehicle (its Extras tab), or with
 * every vehicle (Settings › Extras, productId null). docs/phase-2-plan.md
 * §5.2, §7.
 *
 * Owners and managers edit. Everyone else reads (extras_roles('read')):
 * the same lists with no box, button or switch. The database refuses a
 * save from anyone else whatever a screen shows.
 */
export async function ExtrasPanel({
  slug,
  tenantId,
  role,
  productId,
}: {
  slug: string;
  tenantId: string;
  role: Role;
  productId: string | null;
}) {
  const [t, screen] = await Promise.all([
    getTranslations("Products.extras"),
    getExtrasScreen(tenantId, productId, canPricing(role, "read")),
  ]);
  const edit = canExtras(role, "write");
  const products: EditorProduct[] = [...screen.products.values()];
  const byId = screen.products;
  const vehicle = productId !== null;
  const list = vehicle ? screen.own : screen.shopWide;
  const settingsLink = vehicle && canSeeExtrasSettings(role) && (
    <p className="text-sm">
      <Link
        href={`/${slug}/settings/extras`}
        className="font-medium underline underline-offset-4"
      >
        {t("shopLink")}
      </Link>
    </p>
  );

  if (edit)
    return (
      <Panel intro={t(vehicle ? "intro" : "everyIntro")} className="max-w-3xl">
        <ExtrasEditor
          slug={slug}
          productId={productId}
          initial={draftsOf(list)}
          shopWide={screen.shopWide.map((line) => ({
            extraProductId: line.extra_product_id,
            included: line.included_quantity,
            most: line.max_quantity,
          }))}
          products={products}
        />
        {settingsLink && <div className="mt-6">{settingsLink}</div>}
      </Panel>
    );

  // Read-only: what is offered, as it is saved.
  const offered = list.filter((line) => line.offered);
  const line = (row: SavedExtra) => (
    <li key={row.extra_product_id} className="space-y-1 p-3">
      <ProductName
        product={byId.get(row.extra_product_id)}
        name={byId.get(row.extra_product_id)?.name ?? t("unknown")}
      />
      <p className="text-sm">
        <Quantities included={row.included_quantity} most={row.max_quantity} />
      </p>
    </li>
  );
  return (
    <Panel intro={vehicle ? t("introRead") : undefined} className="max-w-3xl">
      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="font-semibold">
            {t(vehicle ? "ownTitle" : "everyTitle")}
          </h2>
          {offered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(vehicle ? "ownNone" : "everyNone")}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">{offered.map(line)}</ul>
          )}
        </section>
        {vehicle && (
          <section className="space-y-3">
            <h2 className="font-semibold">{t("shopTitle")}</h2>
            {screen.shopWide.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shopNone")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {screen.shopWide.map((row) => {
                  const state = shopWideState(row.extra_product_id, screen.own);
                  return (
                    <li
                      key={row.extra_product_id}
                      className="space-y-1 p-3"
                      data-shop-extra={row.extra_product_id}
                    >
                      <ProductName
                        product={byId.get(row.extra_product_id)}
                        name={
                          byId.get(row.extra_product_id)?.name ?? t("unknown")
                        }
                      />
                      <p className="text-sm">
                        {state === "notOffered" ? (
                          t("notOfferedHere")
                        ) : state === "own" ? (
                          t("setAbove")
                        ) : (
                          <Quantities
                            included={row.included_quantity}
                            most={row.max_quantity}
                          />
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        {settingsLink}
        <p className="text-xs text-muted-foreground">{t("readOnly")}</p>
      </div>
    </Panel>
  );
}
