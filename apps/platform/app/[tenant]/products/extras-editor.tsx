"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { inputClass } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  extrasErrors,
  type ExtraDraft,
  type ExtrasForm,
  type ShopWideState,
} from "@/lib/extras";
import { cn } from "@/lib/utils";
import { saveExtras } from "./extras-actions";

/** A gear or service product, as the editor shows it. */
export type EditorProduct = {
  id: string;
  name: string;
  type: "gear" | "service";
  retired: boolean;
  /** False: no price yet. Null: the viewer can't see prices. */
  priced: boolean | null;
};

/** A line of the shop's "every vehicle" list, shown on a vehicle's tab. */
export type ShopWideLine = {
  extraProductId: string;
  included: number;
  most: number | null;
};

type Props = {
  slug: string;
  /** The vehicle, or null for Settings › Extras ("every vehicle"). */
  productId: string | null;
  initial: ExtrasForm;
  /** Vehicle tab only: the shop's list, which applies unless opted out. */
  shopWide?: ShopWideLine[];
  products: EditorProduct[];
};

/**
 * The list of gear and services offered with a vehicle, or with every
 * vehicle, for owners and managers: add from the shop's gear and services,
 * the included quantity, the most per vehicle, the order, remove. On a
 * vehicle, each shop-wide extra has "Not offered for this vehicle". The
 * whole list is saved at once (save_product_extras() replaces it).
 */
export function ExtrasEditor({
  slug,
  productId,
  initial,
  shopWide = [],
  products,
}: Props) {
  const t = useTranslations("Products.extras");
  const tErrors = useTranslations("FormErrors");
  const id = useId();
  const [lines, setLines] = useState<ExtraDraft[]>(initial.lines);
  const [notOffered, setNotOffered] = useState<Set<string>>(
    () => new Set(initial.notOffered),
  );
  const [adding, setAdding] = useState("");
  const byId = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const errors = extrasErrors(lines);
  const errorOf = (line: number, field: "included" | "most") => {
    const error = errors.find((e) => e.line === line && e.field === field);
    return error ? tErrors(error.key) : undefined;
  };
  const listed = new Set(lines.map((line) => line.extraProductId));
  const candidates = products.filter((p) => !p.retired && !listed.has(p.id));
  const vehicle = productId !== null;
  const payload = JSON.stringify({
    lines,
    // Only shop-wide extras can be opted out of; one with a line of its own
    // here is set by that line.
    notOffered: vehicle
      ? shopWide
          .map((line) => line.extraProductId)
          .filter((extra) => notOffered.has(extra) && !listed.has(extra))
      : [],
  });

  const update = (index: number, change: Partial<ExtraDraft>) =>
    setLines((all) =>
      all.map((line, i) => (i === index ? { ...line, ...change } : line)),
    );
  const move = (index: number, by: -1 | 1) =>
    setLines((all) => {
      const next = [...all];
      const [line] = next.splice(index, 1);
      next.splice(index + by, 0, line);
      return next;
    });

  return (
    <ActionForm
      action={saveExtras}
      hidden={{ slug, productId: productId ?? "", extras: payload }}
      submitLabel={t("save")}
      submitDisabled={errors.length > 0}
      className="space-y-6"
    >
      <section aria-labelledby={`${id}-own`} className="space-y-3">
        <h2 id={`${id}-own`} className="font-semibold">
          {t(vehicle ? "ownTitle" : "everyTitle")}
        </h2>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(vehicle ? "ownNone" : "everyNone")}
          </p>
        ) : (
          <ol className="divide-y rounded-md border">
            {lines.map((line, index) => {
              const product = byId.get(line.extraProductId);
              const name = product?.name ?? t("unknown");
              const includedError = errorOf(index, "included");
              const mostError = errorOf(index, "most");
              const inputId = `${id}-${line.extraProductId}`;
              return (
                <li
                  key={line.extraProductId}
                  className="space-y-3 p-3"
                  data-extra={line.extraProductId}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <ProductName product={product} name={name} />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11"
                        aria-label={t("moveUp", { name })}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11"
                        aria-label={t("moveDown", { name })}
                        disabled={index === lines.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="size-11 border-destructive/40 text-destructive"
                        aria-label={t("remove", { name })}
                        onClick={() =>
                          setLines((all) => all.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberBox
                      id={`${inputId}-included`}
                      label={t("included")}
                      help={t("includedHelp")}
                      value={line.included}
                      error={includedError}
                      onChange={(value) => update(index, { included: value })}
                    />
                    <NumberBox
                      id={`${inputId}-most`}
                      label={t("most")}
                      help={t("mostHelp")}
                      placeholder={t("noLimit")}
                      value={line.most}
                      error={mostError}
                      onChange={(value) => update(index, { most: value })}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {candidates.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label
                htmlFor={`${id}-add`}
                className="block text-sm font-medium"
              >
                {t("addLabel")}
              </label>
              <select
                id={`${id}-add`}
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
                className={inputClass}
              >
                <option value="">{t("choose")}</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {t(`type.${p.type}`)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              disabled={!adding}
              onClick={() => {
                setLines((all) => [
                  ...all,
                  { extraProductId: adding, included: "0", most: "" },
                ]);
                setAdding("");
              }}
            >
              <Plus aria-hidden />
              {t("add")}
            </Button>
          </div>
        ) : (
          products.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
          )
        )}
      </section>

      {vehicle && (
        <section aria-labelledby={`${id}-shop`} className="space-y-3">
          <h2 id={`${id}-shop`} className="font-semibold">
            {t("shopTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("shopIntro")}</p>
          {shopWide.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("shopNone")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {shopWide.map((line) => {
                const product = byId.get(line.extraProductId);
                const name = product?.name ?? t("unknown");
                const state: ShopWideState = listed.has(line.extraProductId)
                  ? "own"
                  : notOffered.has(line.extraProductId)
                    ? "notOffered"
                    : "offered";
                const boxId = `${id}-off-${line.extraProductId}`;
                return (
                  <li
                    key={line.extraProductId}
                    className="space-y-2 p-3"
                    data-shop-extra={line.extraProductId}
                  >
                    <ProductName product={product} name={name} />
                    <p
                      className={cn(
                        "text-sm",
                        state !== "offered" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      <Quantities included={line.included} most={line.most} />
                    </p>
                    {state === "own" ? (
                      <p className="text-sm text-muted-foreground">
                        {t("setAbove")}
                      </p>
                    ) : (
                      <label
                        htmlFor={boxId}
                        className="flex min-h-11 items-center gap-3 text-sm font-medium"
                      >
                        <input
                          id={boxId}
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={state === "notOffered"}
                          onChange={(event) =>
                            setNotOffered((all) => {
                              const next = new Set(all);
                              if (event.target.checked)
                                next.add(line.extraProductId);
                              else next.delete(line.extraProductId);
                              return next;
                            })
                          }
                        />
                        {t("notOffered")}
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </ActionForm>
  );
}

function NumberBox({
  id,
  label,
  help,
  placeholder,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  placeholder?: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputClass, "tabular-nums")}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {help}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A product's name with what it is, and why it is not offered if it isn't. */
export function ProductName({
  product,
  name,
}: {
  product: EditorProduct | undefined;
  name: string;
}) {
  const t = useTranslations("Products.extras");
  return (
    <p className="min-w-0">
      <span className="font-medium">{name}</span>
      {product && (
        <span className="ml-2 text-xs text-muted-foreground">
          {t(`type.${product.type}`)}
        </span>
      )}
      {product?.retired && (
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
          {t("retired")}
        </span>
      )}
      {product && !product.retired && product.priced === false && (
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
          {t("noPrice")}
        </span>
      )}
    </p>
  );
}

/** "2 included · Most per vehicle: 4" in the shop's words. */
export function Quantities({
  included,
  most,
}: {
  included: number;
  most: number | null;
}) {
  const t = useTranslations("Products.extras");
  return (
    <>
      {t("includedCount", { count: included })}
      {" · "}
      {most === null ? t("mostNone") : t("mostCount", { count: most })}
    </>
  );
}
