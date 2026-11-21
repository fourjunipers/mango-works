import { canSeeArea, type Role } from "./roles";

/**
 * Who opens which part of Settings.
 *
 * Settings is for owners and managers (SPEC › Who uses it), and every
 * Settings page checks it itself (requireArea(slug, "settings")), with one
 * exception: Settings › Extras, which staff read too, with no edit
 * controls (Phase 2 stage 6, the owner's brief). Mechanics and drivers see
 * a vehicle's extras on its Extras tab.
 *
 * tests/settings-access.test.ts holds every other Settings page to its own
 * check, since the Settings layout no longer turns staff away.
 */

export const settingsSections = [
  "shop",
  "pricing",
  "seasons",
  "priceLists",
  "coupons",
  "extras",
  "bookingRules",
] as const;
export type SettingsSection = (typeof settingsSections)[number];

/** Settings › Extras: owners and managers edit, staff read. */
export function canSeeExtrasSettings(role: Role): boolean {
  return canSeeArea(role, "settings") || role === "staff";
}

/** Whether a role gets into Settings at all. */
export function canEnterSettings(role: Role): boolean {
  return canSeeArea(role, "settings") || canSeeExtrasSettings(role);
}

/** The sections a role sees in Settings' own menu. */
export function settingsSectionsFor(role: Role): readonly SettingsSection[] {
  if (canSeeArea(role, "settings")) return settingsSections;
  return canSeeExtrasSettings(role) ? ["extras"] : [];
}
