"use client";

import {
  startTransition,
  useActionState,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import {
  ActionForm,
  type FormState,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/action-form";
import { transmissions } from "@/lib/fleet";
import { Field, inputClass } from "@/components/form";
import { countProblems, typedCount } from "@/lib/listing-settings";
import type { ListChoice } from "@/lib/model-options";
import { cn } from "@/lib/utils";
import { linkModelToPreset, submitModelToCatalog } from "../fleet/actions";
import {
  changeListingEntry,
  disconnectListing,
  saveListingSettings,
  setListingSwitch,
} from "./actions";

/**
 * The Moto Mangos panel's forms, in the order they sit on a product's page
 * on its Moto Mangos tab (owner, 13 Nov 2026): pick your make and model
 * from the list; if it isn't there, send its details for review; and, once a
 * model is selected or approved, the listing switch and settings.
 */

/**
 * "Select your make and model from the list": Make, then Model (with the
 * years it covers), the second filtered by the first. Selecting one takes the
 * list's details and needs no review. Native selects, so they work with a
 * finger, a mouse or a keyboard; without JavaScript the second lists every
 * model.
 */
export function ChooseFromListForm({
  slug,
  id,
  choices,
  change,
}: {
  slug: string;
  id: string;
  /** The Moto Mangos list, by make then model. */
  choices: ListChoice[];
  /** "Change model": the product is on an entry already and moves to this one. */
  change?: boolean;
}) {
  const t = useTranslations("Fleet.motoMangos");
  const tFleet = useTranslations("Fleet");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const makes = [...new Set(choices.map((choice) => choice.make))];
  const models = make ? choices.filter((choice) => choice.make === make) : [];
  return (
    <ActionForm
      action={change ? changeListingEntry : linkModelToPreset}
      hidden={{ slug, id }}
      submitLabel={t("useChosen")}
    >
      <fieldset>
        <legend className="mb-2 block text-sm font-medium">
          {t(change ? "changeModelLegend" : "selectFromList")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="list-make" label={tFleet("what.make")}>
            <select
              id="list-make"
              value={make}
              required
              onChange={(event) => {
                setMake(event.target.value);
                setModel("");
              }}
              className={inputClass}
            >
              <option value="">—</option>
              {makes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="catalog_id" label={tFleet("what.model")}>
            <select
              id="catalog_id"
              name="catalog_id"
              value={model}
              required
              disabled={!make}
              onChange={(event) => setModel(event.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              {models.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>
    </ActionForm>
  );
}

/**
 * For a product already on a Moto Mangos list entry (owner, 13 Nov 2026;
 * owners and managers only): "Change model", the same Make then Model
 * dropdowns and Connect button, and "Disconnect", which switches the listing
 * off and clears the list entry after a confirmation. Neither touches a
 * booking that was already made: the line above the buttons says how many
 * there are.
 */
export function ListEntryActions({
  slug,
  id,
  choices,
  upcoming,
}: {
  slug: string;
  id: string;
  /** The Moto Mangos list without the entry the product is on. */
  choices: ListChoice[];
  /** Bookings on this product's vehicles that have not ended. */
  upcoming: number;
}) {
  const t = useTranslations("Fleet.motoMangos");
  return (
    <div className="mt-4 space-y-3">
      {upcoming > 0 && (
        <p
          role="note"
          className="rounded-md border border-highlight-border bg-highlight p-3 text-sm text-highlight-foreground"
        >
          {t("upcomingBookings", { count: upcoming })}
        </p>
      )}
      <details className="group rounded-md border">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 transition-transform group-open:rotate-180"
          />
          {t("changeModel")}
        </summary>
        <div className="border-t p-3">
          <p className="mb-3 text-sm text-muted-foreground">
            {t("changeModelHelp")}
          </p>
          <ChooseFromListForm slug={slug} id={id} choices={choices} change />
        </div>
      </details>
      <div className="rounded-md border p-3">
        <p className="mb-3 text-sm text-muted-foreground">
          {t("disconnectHelp")}
        </p>
        <ActionForm
          action={disconnectListing}
          hidden={{ slug, id }}
          submitLabel={t("disconnect")}
          confirm={t("disconnectConfirm")}
          destructive
        />
      </div>
    </div>
  );
}

/**
 * "Don't see your bike above? Send us the details and we'll get it added":
 * the line opens the review form. This is the only place on the platform
 * that asks for a make, model, engine size, transmission and year, and all
 * five are required. Nothing is sent until the form is opened, filled in and
 * its own button pressed.
 */
export function ReviewRequest({
  slug,
  id,
  again,
  open,
  values,
}: {
  slug: string;
  id: string;
  /** Its last request was turned down: this sends it for review again. */
  again?: boolean;
  /** Start opened (a rejected request being corrected). */
  open?: boolean;
  /** What was sent before, or a first guess at the make and model from the name. */
  values: { make: string; model: string; cc: string; transmission: string };
}) {
  const t = useTranslations("Fleet.motoMangos");
  const tFleet = useTranslations("Fleet");
  return (
    <details
      id="send-for-review"
      open={open}
      className="group scroll-mt-20 rounded-md border"
    >
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
        />
        {t("notInList")}
      </summary>
      <div className="border-t p-3">
        <p className="mb-3 text-sm text-muted-foreground">{t("submitHelp")}</p>
        <ActionForm
          action={submitModelToCatalog}
          hidden={{ slug, id }}
          submitLabel={t(again ? "submitAgain" : "submit")}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput
              name="make"
              label={tFleet("what.make")}
              required
              maxLength={40}
              defaultValue={values.make}
            />
            <TextInput
              name="model"
              label={tFleet("what.model")}
              required
              maxLength={60}
              defaultValue={values.model}
            />
            <TextInput
              name="cc"
              label={tFleet("what.cc")}
              required
              inputMode="numeric"
              maxLength={5}
              defaultValue={values.cc}
            />
            <SelectInput
              name="transmission"
              label={tFleet("what.transmission")}
              required
              defaultValue={values.transmission}
              options={[
                { value: "", label: "—" },
                ...transmissions.map((value) => ({
                  value,
                  label: tFleet(`transmission.${value}`),
                })),
              ]}
            />
            <TextInput
              name="year"
              label={t("bikeYear")}
              help={t("bikeYearHelp")}
              required
              inputMode="numeric"
              maxLength={4}
            />
          </div>
          <TextArea name="note" label={t("note")} maxLength={500} />
        </ActionForm>
      </div>
    </details>
  );
}

/**
 * The on and off switch. It saves by itself the moment it is pressed (no
 * Save button), and says so. Usable only once the product is on an approved
 * list entry and not retired; until then it is disabled and the line above
 * the listing part says why.
 */
export function ListingSwitch({
  slug,
  id,
  on,
  enabled,
}: {
  slug: string;
  id: string;
  on: boolean;
  enabled: boolean;
}) {
  const t = useTranslations("Fleet.motoMangos");
  const tErrors = useTranslations("FormErrors");
  const tCommon = useTranslations("Common");
  const [state, action, pending] = useActionState<FormState, FormData>(
    setListingSwitch,
    {},
  );
  // While it saves, the switch shows where it is going.
  const [target, setTarget] = useState(on);
  const shown = pending ? target : on;
  const error = state.errors?.form;
  return (
    <form
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setTarget(!on);
        startTransition(() => action(data));
      }}
      className="space-y-1"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="enabled" value={on ? "off" : "on"} />
      <div className="flex min-h-11 items-center justify-between gap-4">
        <span id="listing-switch-label" className="text-sm font-medium">
          {t("list")}
        </span>
        <button
          type="submit"
          role="switch"
          aria-checked={shown}
          aria-labelledby="listing-switch-label"
          aria-describedby="listing-switch-state"
          disabled={!enabled || pending}
          className={cn(
            "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
            shown ? "bg-primary" : "bg-input",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-7 rounded-full bg-background shadow transition-transform",
              shown ? "translate-x-6" : "translate-x-0",
            )}
          />
        </button>
      </div>
      <p
        id="listing-switch-state"
        role="status"
        className="text-sm text-muted-foreground"
      >
        {pending ? tCommon("saving") : t(on ? "switchOn" : "switchOff")}
      </p>
      {error && !pending && (
        <p role="alert" className="text-sm text-destructive">
          {tErrors.has(error as "saveFailed")
            ? tErrors(error as "saveFailed")
            : tErrors("saveFailed")}
        </p>
      )}
    </form>
  );
}

type SettingValues = {
  instant_units: string;
  request_units: string;
  ready_now: string;
  lead_time_hours: string;
};

const sameValues = (a: SettingValues, b: SettingValues) =>
  a.instant_units === b.instant_units &&
  a.request_units === b.request_units &&
  a.ready_now === b.ready_now &&
  a.lead_time_hours === b.lead_time_hours;

/**
 * Instant units, Request units, Walk-ins and the lead time, saved together
 * under one Save button. Under the counts, a line worked out from them
 * ("Offering 3 of 8 bikes for advance booking") and, as soon as a count is
 * typed too high, the reason; Save waits until it is put right. The page's
 * values go along as was_*, so only what changed is saved.
 */
export function ListingSettingsForm({
  slug,
  id,
  enabled,
  active,
  values,
}: {
  slug: string;
  id: string;
  enabled: boolean;
  /** The product's active vehicles: what the counts may reach. */
  active: number;
  values: SettingValues;
}) {
  const t = useTranslations("Fleet.motoMangos");
  const tModel = useTranslations("Fleet.model");
  const tErrors = useTranslations("FormErrors");
  const [typed, setTyped] = useState(values);
  // After a save the page sends its new values: start again from those.
  const [from, setFrom] = useState(values);
  if (!sameValues(from, values)) {
    setFrom(values);
    setTyped(values);
  }
  const instant = typedCount(typed.instant_units);
  const request = typedCount(typed.request_units);
  const walkIns = typedCount(typed.ready_now);
  const problems =
    instant === null || request === null || walkIns === null
      ? []
      : countProblems(
          {
            instant_units: instant,
            request_units: request,
            ready_now: walkIns,
          },
          active,
        );
  const input = (name: keyof SettingValues) => ({
    value: typed[name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setTyped((now) => ({ ...now, [name]: value }));
    },
  });

  const fields = (
    <fieldset disabled={!enabled} className="space-y-4 disabled:opacity-60">
      <legend className="mb-3 text-sm font-medium">
        {t("quantitiesTitle")}
      </legend>
      <TextInput
        name="instant_units"
        label={tModel("instantUnits")}
        help={t("instantHelp")}
        inputMode="numeric"
        className="max-w-28"
        {...input("instant_units")}
      />
      <TextInput
        name="request_units"
        label={tModel("requestUnits")}
        help={t("requestHelp")}
        inputMode="numeric"
        className="max-w-28"
        {...input("request_units")}
      />
      <TextInput
        name="ready_now"
        label={tModel("readyNow")}
        help={t("walkinsHelp")}
        inputMode="numeric"
        className="max-w-28"
        {...input("ready_now")}
      />
      {instant !== null && request !== null && (
        <p data-offering className="text-sm font-medium">
          {t("offering", { count: instant + request, total: active })}
        </p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{tErrors(problem)}</li>
          ))}
        </ul>
      )}
      <TextInput
        name="lead_time_hours"
        label={t("leadTime")}
        help={t("leadTimeHelp")}
        inputMode="numeric"
        maxLength={3}
        className="max-w-28"
        {...input("lead_time_hours")}
      />
    </fieldset>
  );
  if (!enabled) return fields;
  return (
    <ActionForm
      action={saveListingSettings}
      hidden={{
        slug,
        id,
        was_instant_units: values.instant_units,
        was_request_units: values.request_units,
        was_ready_now: values.ready_now,
        was_lead_time_hours: values.lead_time_hours,
      }}
      submitDisabled={problems.length > 0}
    >
      {fields}
    </ActionForm>
  );
}
