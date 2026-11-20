"use client";

import { useTranslations } from "next-intl";
import {
  ActionForm,
  CheckboxInput,
  Panel,
  TextInput,
} from "@/components/action-form";
import {
  ruleField,
  ruleText,
  type BookingRulesRead,
} from "@/lib/booking-rules";
import { saveBookingRulesAction } from "./actions";

/**
 * Settings › Booking rules (Phase 2 stage 11): the shop's overbooking, hold
 * length and default buffers; each location's notice, cut-off and minimum
 * days; each vehicle's own minimum days. One Save for all of it, through
 * platform.save_booking_rules(). Blank is "no rule of its own".
 */
export function BookingRulesForm({
  slug,
  rules,
}: {
  slug: string;
  rules: BookingRulesRead;
}) {
  const t = useTranslations("Settings.bookingRules");
  const many = rules.locations.length > 1;

  return (
    <ActionForm
      action={saveBookingRulesAction}
      hidden={{ slug }}
      className="max-w-3xl"
    >
      <Panel title={t("shop.title")} intro={t("shop.intro")}>
        <div className="mt-4 space-y-5">
          <CheckboxInput
            name="allow_overbooking"
            label={t("shop.overbooking")}
            help={t("shop.overbookingHelp")}
            defaultChecked={rules.shop.allow_overbooking}
          />
          <div className="grid gap-5 sm:grid-cols-3">
            <TextInput
              name="hold_minutes"
              label={t("shop.hold")}
              help={t("shop.holdHelp")}
              required
              inputMode="numeric"
              maxLength={2}
              defaultValue={String(rules.shop.hold_minutes)}
            />
            <TextInput
              name="buffer_before_hours"
              label={t("shop.bufferBefore")}
              help={t("shop.bufferHelp")}
              inputMode="decimal"
              maxLength={6}
              defaultValue={ruleText.hours(rules.shop.buffer_before_minutes)}
            />
            <TextInput
              name="buffer_after_hours"
              label={t("shop.bufferAfter")}
              help={t("shop.bufferHelp")}
              inputMode="decimal"
              maxLength={6}
              defaultValue={ruleText.hours(rules.shop.buffer_after_minutes)}
            />
          </div>
        </div>
      </Panel>

      {rules.locations.map((location) => (
        <Panel
          key={location.id}
          title={
            many
              ? t("location.titleNamed", { name: location.name })
              : t("location.title")
          }
          intro={t("location.intro")}
        >
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <TextInput
              name={ruleField.location(location.id, "min_notice_hours")}
              label={t("location.notice")}
              help={t("location.noticeHelp")}
              inputMode="numeric"
              maxLength={3}
              defaultValue={ruleText.whole(location.min_notice_hours)}
            />
            <TextInput
              name={ruleField.location(location.id, "booking_cutoff_minutes")}
              label={t("location.cutoff")}
              help={t("location.cutoffHelp")}
              inputMode="numeric"
              maxLength={5}
              defaultValue={ruleText.whole(location.booking_cutoff_minutes)}
            />
            <TextInput
              name={ruleField.location(location.id, "min_days_advance")}
              label={t("location.minDaysAdvance")}
              help={t("location.minDaysAdvanceHelp")}
              inputMode="numeric"
              maxLength={3}
              defaultValue={ruleText.whole(location.min_days_advance)}
            />
            <TextInput
              name={ruleField.location(location.id, "min_days_walkin")}
              label={t("location.minDaysWalkin")}
              help={t("location.minDaysWalkinHelp")}
              inputMode="numeric"
              maxLength={3}
              defaultValue={ruleText.whole(location.min_days_walkin)}
            />
          </div>
        </Panel>
      ))}

      <Panel title={t("vehicles.title")} intro={t("vehicles.intro")}>
        {rules.vehicles.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("vehicles.none")}
          </p>
        ) : (
          <ul className="mt-4 divide-y rounded-md border">
            {rules.vehicles.map((vehicle) => (
              <li key={vehicle.id} className="p-3">
                <fieldset>
                  <legend className="mb-2 font-medium">{vehicle.name}</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput
                      name={ruleField.vehicle(vehicle.id, "min_days_advance")}
                      label={t("vehicles.advance")}
                      inputMode="numeric"
                      maxLength={3}
                      defaultValue={ruleText.whole(vehicle.min_days_advance)}
                    />
                    <TextInput
                      name={ruleField.vehicle(vehicle.id, "min_days_walkin")}
                      label={t("vehicles.walkin")}
                      inputMode="numeric"
                      maxLength={3}
                      defaultValue={ruleText.whole(vehicle.min_days_walkin)}
                    />
                  </div>
                </fieldset>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ActionForm>
  );
}
