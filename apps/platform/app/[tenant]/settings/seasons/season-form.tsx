"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ActionForm,
  CheckboxInput,
  Panel,
  TextInput,
  useFieldError,
} from "@/components/action-form";
import { inputClass } from "@/components/form";
import type { SeasonDraft } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { deleteSeason, saveSeason } from "./actions";

type Product = { id: string; name: string; type: string; retired: boolean };

/**
 * A season (docs/products-redesign.md §9.5): a name, a first and last day,
 * every year or one year only, Increase or Decrease by a percentage (a
 * choice and a number, never a typed minus sign), and all products or
 * chosen ones. Switched off, it stays saved and changes no price.
 */
export function SeasonForm({
  slug,
  id,
  initial,
  products,
  canEdit,
}: {
  slug: string;
  id?: string;
  initial: SeasonDraft;
  products: Product[];
  canEdit: boolean;
}) {
  const t = useTranslations("Settings.seasons");
  const [allProducts, setAllProducts] = useState(initial.allProducts);
  const [search, setSearch] = useState("");
  const chosen = new Set(initial.productIds);
  // Retired products show only when already chosen.
  const offered = products.filter((p) => !p.retired || chosen.has(p.id));
  const shown = offered.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <ActionForm
        action={saveSeason}
        hidden={{ slug, ...(id ? { id } : {}) }}
        submitLabel={id ? t("save") : t("create")}
        showSubmit={canEdit}
      >
        <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
          <Panel>
            <div className="space-y-4">
              <TextInput
                name="name"
                label={t("name")}
                help={t("nameHelp")}
                maxLength={120}
                defaultValue={initial.name}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  name="startsOn"
                  type="date"
                  label={t("startsOn")}
                  defaultValue={initial.startsOn}
                />
                <TextInput
                  name="endsOn"
                  type="date"
                  label={t("endsOn")}
                  defaultValue={initial.endsOn}
                />
              </div>
              <CheckboxInput
                name="repeatsYearly"
                label={t("repeatsYearly")}
                help={t("repeatsYearlyHelp")}
                defaultChecked={initial.repeatsYearly}
              />
            </div>
          </Panel>

          <Panel title={t("change")} intro={t("changeIntro")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-2">
                <legend className="mb-1.5 text-sm font-medium">
                  {t("direction")}
                </legend>
                {(["decrease", "increase"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 has-checked:border-primary has-checked:bg-highlight"
                  >
                    <input
                      type="radio"
                      name="direction"
                      value={value}
                      defaultChecked={initial.direction === value}
                      className="size-5 accent-primary"
                    />
                    <span className="font-medium">{t(value)}</span>
                  </label>
                ))}
              </fieldset>
              <TextInput
                name="percent"
                label={t("percent")}
                help={t("percentHelp")}
                inputMode="decimal"
                defaultValue={initial.percent}
              />
            </div>
          </Panel>

          <Panel title={t("products")} intro={t("productsIntro")}>
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("products")}</legend>
              {(["all", "chosen"] as const).map((scope) => (
                <label
                  key={scope}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 has-checked:border-primary has-checked:bg-highlight"
                >
                  <input
                    type="radio"
                    name="scope"
                    value={scope}
                    defaultChecked={(scope === "all") === initial.allProducts}
                    onChange={() => setAllProducts(scope === "all")}
                    className="size-5 accent-primary"
                  />
                  <span className="font-medium">
                    {t(scope === "all" ? "scopeAll" : "scopeChosen")}
                  </span>
                </label>
              ))}
            </fieldset>
            {/* Kept in the form while hidden, so a switch back keeps the choice. */}
            <div className={cn("mt-4 space-y-3", allProducts && "hidden")}>
              <input
                type="search"
                aria-label={t("search")}
                placeholder={t("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={inputClass}
              />
              <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
                {offered.map((p) => (
                  <li
                    key={p.id}
                    className={cn(!shown.includes(p) && "hidden")}
                  >
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input
                        type="checkbox"
                        name="productIds"
                        value={p.id}
                        defaultChecked={chosen.has(p.id)}
                        className="size-5 accent-primary"
                      />
                      <span>
                        {p.name}
                        {p.retired && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t("retired")}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <ProductsError />
            </div>
          </Panel>

          <Panel>
            <CheckboxInput
              name="active"
              label={t("active")}
              help={t("activeHelp")}
              defaultChecked={initial.active}
            />
          </Panel>
        </fieldset>
      </ActionForm>

      {id && canEdit && (
        <ActionForm
          action={deleteSeason}
          hidden={{ slug, id }}
          submitLabel={t("delete")}
          confirm={t("deleteConfirm")}
          destructive
        />
      )}
    </div>
  );
}

function ProductsError() {
  const error = useFieldError("products");
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}
