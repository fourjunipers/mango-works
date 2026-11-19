import { describe, expect, it } from "vitest";
import { parseCouponAmount } from "./coupon-form";
import { fromKm, parseDistance, toKm } from "./distance";
import { extrasErrors, extrasPayload } from "./extras";
import {
  catalogSubmitSchema,
  hoursToMinutes,
  minutesToHours,
  modelSchema,
  ownModelSchema,
  unitSchema,
  yearBandSchema,
} from "./fleet";
import { planImport } from "./fleet-import";
import { parseFleetList } from "./fleet-list";
import { parseQuantity } from "./general-products";
import { listingSettingsSchema, typedCount } from "./listing-settings";
import {
  minorDecimal,
  moneyInputValue,
  multiplierText,
  parseMinorUnits,
  parseMoney,
  parseMultiplier,
} from "./money";
import {
  parseScaled,
  parseTypedNumber,
  parseWholeInRange,
  parseWholeNumber,
} from "./number-input";
import { settingsDraft, settingsPayload } from "./pricing-settings";
import { reminderSettingsSchema } from "./renewals";
import { parsePercentBp, percentInput } from "./seasons";

/**
 * The platform's one number rule (lib/number-input.ts), as a table: what a
 * box takes and what it refuses, and every parser on the platform giving the
 * same answer for the same text.
 */

const n = (value: number) => BigInt(value);

/** Typed text, and its digits before and after the point. */
const VALID: [string, string, string][] = [
  ["0", "0", ""],
  ["7", "7", ""],
  ["300", "300", ""],
  ["1400", "1400", ""],
  ["1234567", "1234567", ""],
  ["12.5", "12", "5"],
  ["0.5", "0", "5"],
  ["0.005", "0", "005"],
  ["300.00", "300", "00"],
  ["1,234", "1234", ""],
  ["1,234.5", "1234", "5"],
  ["12,345", "12345", ""],
  ["123,456", "123456", ""],
  ["1,234,567", "1234567", ""],
  ["1,234,567.89", "1234567", "89"],
  ["50,000", "50000", ""],
  // Leading zeros are dropped; spaces around the number are not part of it.
  ["007", "7", ""],
  ["00.5", "0", "5"],
  ["  1,000  ", "1000", ""],
  ["\t42\n", "42", ""],
];

const INVALID: [string, string][] = [
  ["1,23", "a comma before two digits"],
  ["12,34,5", "groups not of three"],
  ["2,50", "a comma as a decimal point"],
  ["12,5", "a comma as a decimal point"],
  ["0,5", "a comma as a decimal point"],
  ["0,500", "a group after a leading zero"],
  ["01,234", "a first group that starts with zero"],
  ["1,2345", "a last group of four"],
  ["1234,567", "a first group of four"],
  ["1,,234", "two commas together"],
  [",500", "nothing before the comma"],
  ["500,", "nothing after the comma"],
  ["1,234,", "nothing after the last comma"],
  ["1.234,56", "a dot for thousands and a comma for decimals"],
  ["1.234.567", "two dots"],
  ["1,234.5.6", "two dots"],
  ["1.2,345", "a comma after the decimal point"],
  ["1 400", "a space"],
  ["1 400.50", "a space"],
  ["1 400", "a no-break space"],
  ["1_400", "an underscore"],
  ["1'400", "an apostrophe"],
  ["-200", "a minus sign"],
  ["−200", "a typographic minus sign"],
  ["+200", "a plus sign"],
  ["2.", "nothing after the dot"],
  [".5", "nothing before the dot"],
  [".", "a dot alone"],
  [",", "a comma alone"],
  ["1e3", "an exponent"],
  ["0x10", "hexadecimal"],
  ["200 THB", "a currency code"],
  ["฿200", "a currency sign"],
  ["$200", "a currency sign"],
  ["abc", "letters"],
  ["２００", "full-width digits"],
  ["๒๐๐", "Thai digits"],
  ["Infinity", "a word"],
  ["NaN", "a word"],
];

describe("the one number rule: a dot for decimals, a comma only between thousands", () => {
  it.each(VALID)("takes %j", (typed, whole, fraction) => {
    expect(parseTypedNumber(typed)).toEqual({ whole, fraction });
  });

  it.each(INVALID)("refuses %j (%s)", (typed) => {
    expect(parseTypedNumber(typed)).toBe("invalid");
  });

  it("blank is not a number and not a mistake", () => {
    for (const blank of ["", " ", "\t", "\n  "]) {
      expect(parseTypedNumber(blank), JSON.stringify(blank)).toBeNull();
    }
  });

  it("the three named in the rule: 1,234.5 is fine; 1,23 and 12,34,5 are refused", () => {
    expect(parseTypedNumber("1,234.5")).toEqual({
      whole: "1234",
      fraction: "5",
    });
    expect(parseTypedNumber("1,23")).toBe("invalid");
    expect(parseTypedNumber("12,34,5")).toBe("invalid");
  });

  it("parseScaled keeps every digit and refuses more decimal places than asked", () => {
    expect(parseScaled("12.5", 2)).toBe(n(1250));
    expect(parseScaled("1,234.5", 2)).toBe(n(123450));
    expect(parseScaled("1,234.56", 2)).toBe(n(123456));
    expect(parseScaled("1,234.567", 2)).toBe("invalid");
    expect(parseScaled("5", 0)).toBe(n(5));
    expect(parseScaled("5.0", 0)).toBe("invalid");
    expect(parseScaled("", 2)).toBeNull();
    // 30 digits: no float is ever involved.
    expect(parseScaled("123456789012345678901234567890.12", 2)).toBe(
      BigInt("12345678901234567890123456789012"),
    );
  });

  it("parseWholeNumber takes no decimal point at all", () => {
    expect(parseWholeNumber("1,000")).toBe(n(1000));
    expect(parseWholeNumber("42")).toBe(n(42));
    expect(parseWholeNumber("42.0")).toBe("invalid");
    expect(parseWholeNumber("4 2")).toBe("invalid");
    expect(parseWholeNumber("")).toBeNull();
  });

  it("parseWholeInRange is a whole number inside its limits, as a plain number", () => {
    expect(parseWholeInRange("1,000", 0, 9999)).toBe(1000);
    expect(parseWholeInRange(" 12 ", 1, 28)).toBe(12);
    expect(parseWholeInRange("007", 1, 28)).toBe(7);
    expect(parseWholeInRange("0", 1, 28)).toBe("invalid");
    expect(parseWholeInRange("29", 1, 28)).toBe("invalid");
    expect(parseWholeInRange("1.0", 1, 28)).toBe("invalid");
    expect(parseWholeInRange("", 1, 28)).toBeNull();
    // Far past any limit: compared as digits, never as a float.
    expect(parseWholeInRange("9".repeat(40), 0, 9999)).toBe("invalid");
  });
});

/** Whole numbers written some other way: a whole-number box takes none. */
const NOT_WHOLE = [
  "2e3",
  "0x7E4",
  "+2020",
  "-1",
  "1.5",
  "1 000",
  "1_000",
  "１２",
  "٣",
  "12,5",
  "1,00",
];
/** A few whole numbers to try with ".0" after them. */
const sample = ["1", "12", "2020"];

/** A zod schema's answer for one box: its number, null, or "invalid". */
const answer = (
  result: { success: boolean; data?: unknown },
  field: string,
): unknown =>
  result.success ? (result.data as Record<string, unknown>)[field] : "invalid";

const unit = {
  location_id: "7a0e7c40-5c53-4f0a-8a55-0d9f4d1f6c01",
  plate: "A1",
};
const ownModel = { make: "Honda", model: "PCX", vehicle_type: "car" };
const catalog = {
  make: "Honda",
  model: "PCX",
  cc: "157",
  transmission: "automatic",
  year: "2023",
};
const listing = {
  instant_units: "",
  request_units: "",
  ready_now: "",
  lead_time_hours: "",
};
const extraId = "7a0e7c40-5c53-4f0a-8a55-0d9f4d1f6c02";

/** One line of an extras list, read as the editor and the server read it. */
const extra = (field: "included" | "most", typed: string): unknown => {
  const line = {
    extraProductId: extraId,
    included: "",
    most: "",
    [field]: typed,
  };
  if (extrasErrors([line]).length > 0) return "invalid";
  const saved = extrasPayload({ lines: [line], notOffered: [] })![0];
  return field === "included" ? saved.included_quantity : saved.max_quantity;
};

/** One row of a fleet CSV with one cell filled in. */
const csvRow = (column: string, typed: string, distanceUnit: "km" | "mi") =>
  planImport(
    {
      headers: ["product", "plate", column],
      rows: [
        {
          line: 2,
          values: { product: "Honda PCX", plate: "A-1", [column]: typed },
        },
      ],
    },
    {
      currency: "THB",
      distanceUnit,
      locations: [{ id: "loc", name: "Shop", isDefault: true }],
      products: [{ id: "pcx", name: "Honda PCX" }],
      plates: [],
      newId: () => "new",
    },
  );
const csvOdometer = (typed: string, distanceUnit: "km" | "mi" = "km") => {
  const plan = csvRow("odometer", typed, distanceUnit);
  return plan.errors.length > 0 ? "invalid" : plan.units[0].current_odometer_km;
};
const csvYear = (typed: string) => {
  const plan = csvRow("year", typed, "km");
  return plan.errors.length > 0 ? "invalid" : plan.units[0].model_year;
};

/**
 * Every whole-number box on the platform: its name, how the form reads it
 * ("invalid" when it is refused), a number it takes, and its limits.
 */
const wholeBoxes: [
  string,
  (typed: string) => unknown,
  number,
  number,
  number,
][] = [
  [
    "a vehicle's year",
    (t) =>
      answer(unitSchema.safeParse({ ...unit, model_year: t }), "model_year"),
    2020,
    1950,
    2100,
  ],
  [
    "a product's minimum age",
    (t) =>
      answer(modelSchema.safeParse({ name: "PCX", min_age: t }), "min_age"),
    21,
    14,
    99,
  ],
  [
    "a year band's first year",
    (t) =>
      answer(
        yearBandSchema.safeParse({ year_from: t, year_to: "2100" }),
        "year_from",
      ),
    2020,
    1950,
    2100,
  ],
  [
    "a year band's last year",
    (t) =>
      answer(
        yearBandSchema.safeParse({ year_from: "1950", year_to: t }),
        "year_to",
      ),
    2020,
    1950,
    2100,
  ],
  [
    "a shop's own model's engine size",
    (t) => answer(ownModelSchema.safeParse({ ...ownModel, cc: t }), "cc"),
    1000,
    1,
    20000,
  ],
  [
    "the engine size sent to Moto Mangos",
    (t) => answer(catalogSubmitSchema.safeParse({ ...catalog, cc: t }), "cc"),
    1000,
    1,
    20000,
  ],
  [
    "the year sent to Moto Mangos",
    (t) =>
      answer(catalogSubmitSchema.safeParse({ ...catalog, year: t }), "year"),
    2020,
    1950,
    2100,
  ],
  ...(["instant_units", "request_units", "ready_now"] as const).map(
    (field): [string, (typed: string) => unknown, number, number, number] => [
      `a listing count (${field})`,
      (t) =>
        answer(
          listingSettingsSchema.safeParse({ ...listing, [field]: t }),
          field,
        ),
      1000,
      0,
      9999,
    ],
  ),
  [
    "a listing's lead time in hours",
    (t) =>
      answer(
        listingSettingsSchema.safeParse({ ...listing, lead_time_hours: t }),
        "lead_time_hours",
      ),
    48,
    0,
    720,
  ],
  [
    "a listing count as it is typed (the live line)",
    (t) => typedCount(t) ?? "invalid",
    1000,
    0,
    9999,
  ],
  [
    "the renewal digest's day of the month",
    (t) =>
      answer(
        reminderSettingsSchema.safeParse({
          renewal_reminder_days: "",
          renewal_digest_day: t,
        }),
        "renewal_digest_day",
      ),
    12,
    1,
    28,
  ],
  ["an extra's free quantity", (t) => extra("included", t), 1000, 0, 1000],
  ["an extra's most per vehicle", (t) => extra("most", t), 1000, 1, 1000],
  ["a gear quantity", (t) => parseQuantity(t, 1000), 1000, 0, 1000],
  ["a quantity for sale", (t) => parseQuantity(t, 100_000), 1000, 0, 100_000],
  [
    "the rentals a returning customer needs",
    (t) => {
      const sent = settingsPayload(
        { ...settingsDraft(null, "THB"), returningRentals: t },
        "THB",
        [],
      );
      return sent.ok ? sent.payload.returning_rentals_needed : "invalid";
    },
    1000,
    1,
    1000,
  ],
  [
    "the year in the fleet's filters",
    // A filter that is not a year is no filter: the list is not refused.
    (t) => parseFleetList({ year: t }).year ?? (t.trim() ? "invalid" : null),
    2020,
    1950,
    2100,
  ],
  ["a year in a fleet CSV", csvYear, 2020, 1950, 2100],
];

describe("every parser on the platform reads a number by that rule", () => {
  /** Each parser's answer for one text, as "ok", "blank" or "invalid". */
  const readers: [string, (typed: string) => unknown][] = [
    [
      "an amount (price lists, pricing settings)",
      (t) => parseMinorUnits(t, "THB"),
    ],
    [
      "an amount (fleet costs and prices)",
      (t) => parseMoney(t, "THB") ?? "invalid",
    ],
    ["an amount (coupons)", (t) => parseCouponAmount(t, "THB")],
    [
      "a percentage (seasons, deposits, returning customers, coupons)",
      parsePercentBp,
    ],
    ["a multiplier (price lists)", parseMultiplier],
    ["hours (buffers)", hoursToMinutes],
  ];

  it.each(readers)("%s refuses every text the rule refuses", (_, read) => {
    for (const [typed] of INVALID) {
      expect(read(typed), JSON.stringify(typed)).toBe("invalid");
    }
  });

  it.each(wholeBoxes)("%s refuses every text the rule refuses", (_, read) => {
    for (const [typed] of INVALID) {
      expect(read(typed), JSON.stringify(typed)).toBe("invalid");
    }
    // A whole number has no decimal point, and no other way to be written.
    for (const typed of [...NOT_WHOLE, ...sample.map((s) => `${s}.0`)]) {
      expect(read(typed), JSON.stringify(typed)).toBe("invalid");
    }
  });

  it.each(wholeBoxes)(
    "%s takes a whole number, with thousands commas and spaces around it",
    (_, read, value) => {
      const grouped = new Intl.NumberFormat("en-US").format(value);
      for (const typed of [
        String(value),
        ` ${value} `,
        `\t${value}\n`,
        `00${value}`,
        grouped,
      ]) {
        expect(read(typed), JSON.stringify(typed)).toBe(value);
      }
    },
  );

  it("a blank whole-number box is none (null or 0), or refused where the box must be filled", () => {
    // Boxes that must be filled: blank is refused, as it was.
    const required = [
      "a year band's first year",
      "a year band's last year",
      "the engine size sent to Moto Mangos",
      "the year sent to Moto Mangos",
      "the rentals a returning customer needs",
    ];
    // Boxes where blank is 0 rather than "no value".
    const zero = [
      "a listing count (instant_units)",
      "a listing count (request_units)",
      "a listing count (ready_now)",
      "a listing count as it is typed (the live line)",
      "an extra's free quantity",
      "a gear quantity",
      "a quantity for sale",
    ];
    for (const [name, read] of wholeBoxes) {
      for (const blank of ["", "  "]) {
        expect(read(blank), `${name} ${JSON.stringify(blank)}`).toBe(
          required.includes(name) ? "invalid" : zero.includes(name) ? 0 : null,
        );
      }
    }
  });

  it("a refused whole number is told with the box's own message, as before", () => {
    const message = (result: {
      success: boolean;
      error?: { issues: { message: string }[] };
    }) => result.error?.issues.map((issue) => issue.message);
    for (const bad of ["2e3", "0x7E4", "12,5", "1.0", "abc", "999999"]) {
      expect(
        message(unitSchema.safeParse({ ...unit, model_year: bad })),
        bad,
      ).toEqual(["invalidYear"]);
      expect(
        message(modelSchema.safeParse({ name: "PCX", min_age: bad })),
        bad,
      ).toEqual(["invalidNumber"]);
      expect(
        message(ownModelSchema.safeParse({ ...ownModel, cc: bad })),
        bad,
      ).toEqual(["ccRange"]);
      expect(
        message(catalogSubmitSchema.safeParse({ ...catalog, cc: bad })),
        bad,
      ).toEqual(["ccRange"]);
      expect(
        message(catalogSubmitSchema.safeParse({ ...catalog, year: bad })),
        bad,
      ).toEqual(["invalidYear"]);
      expect(
        message(
          listingSettingsSchema.safeParse({ ...listing, ready_now: bad }),
        ),
        bad,
      ).toEqual(["invalidNumber"]);
      expect(
        message(
          listingSettingsSchema.safeParse({ ...listing, lead_time_hours: bad }),
        ),
        bad,
      ).toEqual(["leadTimeRange"]);
      expect(
        message(
          reminderSettingsSchema.safeParse({
            renewal_reminder_days: "",
            renewal_digest_day: bad,
          }),
        ),
        bad,
      ).toEqual(["invalidDigestDay"]);
    }
    // A year band needs both years: one left out or blank is "invalidYear".
    expect(message(yearBandSchema.safeParse({ year_to: "2020" }))).toEqual([
      "invalidYear",
    ]);
    expect(
      message(yearBandSchema.safeParse({ year_from: "", year_to: "2020" })),
    ).toEqual(["invalidYear"]);
    // Sent to Moto Mangos with no year or engine size: "required".
    expect(
      message(catalogSubmitSchema.safeParse({ ...catalog, year: "", cc: " " })),
    ).toEqual(["required", "required"]);
    // A number that is not typed text (never from a form) is left as it is.
    expect(unitSchema.parse({ ...unit, model_year: 2024 }).model_year).toBe(
      2024,
    );
  });

  it("the reminder days are a list: a comma is between two numbers, each read by the rule", () => {
    const days = (text: string) =>
      reminderSettingsSchema.safeParse({
        renewal_reminder_days: text,
        renewal_digest_day: "",
      }).data?.renewal_reminder_days ?? "invalid";
    expect(days("45, 30, 14, 7")).toEqual([45, 30, 14, 7]);
    expect(days("7 14;30,30")).toEqual([30, 14, 7]);
    expect(days(" 045 ")).toEqual([45]);
    expect(days("")).toEqual([]);
    // "1,000" here is two numbers, 1 and 0: 0 is not a day.
    expect(days("1,000")).toBe("invalid");
    // "12,5" is 12 and 5, as it always was in this box.
    expect(days("12,5")).toEqual([12, 5]);
    // Every text the rule refuses that is one item (no separator in it).
    for (const [typed] of INVALID) {
      if (/[\s,;]/.test(typed)) continue;
      expect(days(typed), JSON.stringify(typed)).toBe("invalid");
    }
    for (const typed of [...NOT_WHOLE, "7.0", "366", "0"]) {
      if (/[\s,;]/.test(typed)) continue;
      expect(days(typed), JSON.stringify(typed)).toBe("invalid");
    }
  });

  it("the odometer is read by the rule, to one decimal place, wherever it is typed", () => {
    for (const [typed] of INVALID) {
      expect(parseDistance(typed), JSON.stringify(typed)).toBe("invalid");
      expect(csvOdometer(typed), JSON.stringify(typed)).toBe("invalid");
    }
    // "12,5" was read as 125 (the comma was dropped): refused now.
    expect(parseDistance("12,5")).toBe("invalid");
    expect(parseDistance("1,400")).toBe(1400);
    expect(parseDistance("1,400.5")).toBe(1400.5);
    expect(parseDistance(" 12 ")).toBe(12);
    expect(parseDistance("0")).toBe(0);
    expect(parseDistance("0.1")).toBe(0.1);
    expect(parseDistance("")).toBeNull();
    expect(parseDistance("  ")).toBeNull();
    expect(parseDistance("12.34")).toBe("invalid");
    expect(parseDistance("9,999,999")).toBe(9_999_999);
    expect(parseDistance("9999999.1")).toBe("invalid");
    expect(parseDistance("10000000")).toBe("invalid");
    // The file's column is the same reading, in the shop's unit, kept in km.
    expect(csvOdometer("1,400.5")).toBe(1400.5);
    expect(csvOdometer("1,400.5", "mi")).toBe(toKm(1400.5, "mi"));
    expect(csvOdometer("12,5")).toBe("invalid");
    expect(csvOdometer("12 345")).toBe("invalid");
    expect(csvOdometer("12.34")).toBe("invalid");
    expect(csvOdometer("")).toBe(0);
  });

  it("the same text is the same number everywhere it is taken", () => {
    expect(parseMinorUnits("1,234.5", "THB")).toBe(n(123450));
    expect(parseMoney("1,234.5", "THB")).toBe(123450);
    expect(parseCouponAmount("1,234.5", "THB")).toBe(n(123450));
    expect(parsePercentBp("12.5")).toBe(1250);
    expect(parsePercentBp("12.5%")).toBe(1250);
    expect(parsePercentBp("12.5 %")).toBe(1250);
    expect(parseMultiplier("1.1666")).toBe(n(1166600));
    expect(parseMultiplier("x1.5")).toBe(n(1500000));
    expect(hoursToMinutes("1.5")).toBe(90);
  });

  it('"2,50" is refused on every screen: never 250 on one and 2.5 on another', () => {
    expect(parseMinorUnits("2,50", "THB")).toBe("invalid");
    expect(parseMoney("2,50", "THB")).toBeNull();
    expect(parseCouponAmount("2,50", "THB")).toBe("invalid");
    expect(parsePercentBp("2,50")).toBe("invalid");
    expect(parseMultiplier("2,50")).toBe("invalid");
    expect(hoursToMinutes("2,50")).toBe("invalid");
  });

  it("decimal places follow the currency: THB two, KWD three, JPY and VND none", () => {
    expect(parseMinorUnits("0.005", "KWD")).toBe(n(5));
    expect(parseMinorUnits("0.005", "THB")).toBe("invalid");
    expect(parseMinorUnits("50,000", "VND")).toBe(n(50000));
    expect(parseMinorUnits("500.5", "JPY")).toBe("invalid");
    expect(parseMoney("45,000.50", "THB")).toBe(4500050);
    expect(parseMoney("45000.505", "THB")).toBeNull();
  });

  it("a stored value shown in a box is read back as the same value: no saved number is refused on load", () => {
    // Every way a number box is filled from a stored value writes a dot and
    // no separators, which the rule takes: minorDecimal, moneyInputValue,
    // percentInput, multiplierText and minutesToHours for amounts,
    // percentages, multipliers and hours; String(fromKm()) for the odometer
    // (fleet/units/[id]/page.tsx); and String() of the stored number for
    // every whole-number box (further down).
    const amounts = [
      "0",
      "1",
      "99",
      "100",
      "30000",
      "140050",
      "4500050",
      "123456789012345678",
    ];
    for (const currency of ["THB", "USD", "KWD", "JPY", "VND"]) {
      for (const stored of amounts) {
        const shown = minorDecimal(stored, currency);
        expect(parseMinorUnits(shown, currency), `${shown} ${currency}`).toBe(
          BigInt(stored),
        );
        expect(parseCouponAmount(shown, currency), `${shown} ${currency}`).toBe(
          BigInt(stored),
        );
      }
      for (const stored of [0, 1, 99, 100, 64_500, 4_500_050]) {
        const shown = moneyInputValue(stored, currency);
        expect(parseMoney(shown, currency), `${shown} ${currency}`).toBe(
          stored,
        );
      }
    }
    for (const bp of [1, 50, 700, 1250, 2000, 9999, 10000]) {
      expect(parsePercentBp(percentInput(bp)), String(bp)).toBe(bp);
    }
    for (const millionths of ["1", "500000", "1000000", "1166600", "3000000"]) {
      expect(parseMultiplier(multiplierText(millionths)), millionths).toBe(
        BigInt(millionths),
      );
    }
    // Every buffer a form can have saved: 0 to a week, to the minute. Hours
    // are shown to two decimal places, so the minutes read back are the
    // nearest minute to what is shown; what matters is that none is refused.
    for (let minutes = 0; minutes <= 10_080; minutes++) {
      const shown = minutesToHours(minutes);
      const back = hoursToMinutes(shown);
      expect(back, shown).not.toBe("invalid");
      expect(Math.abs((back as number) - minutes), shown).toBeLessThanOrEqual(
        1,
      );
    }
    // The odometer, as the vehicle page fills it: String(fromKm(km, unit)).
    // Stored in km to 0.1; in miles the box shows the nearest 0.1 mi.
    const readings = [0, 0.1, 0.5, 1, 12.5, 999.9, 1400, 1400.5, 123_456.7];
    for (let tenths = 0; tenths <= 20_000; tenths += 7)
      readings.push(tenths / 10);
    for (const km of [...readings, 9_999_999, toKm(9_999_999, "mi")]) {
      for (const unit of ["km", "mi"] as const) {
        if (unit === "km" && km > 9_999_999) continue;
        const shown = String(fromKm(km, unit));
        expect(parseDistance(shown), `${shown} ${unit}`).toBe(fromKm(km, unit));
      }
    }
    // Whole numbers: every box is filled with String() of the stored number.
    for (const [name, read, , min, max] of wholeBoxes) {
      const stored = new Set([min, min + 1, Math.floor((min + max) / 2), max]);
      for (let value = min; value <= Math.min(max, min + 2200); value++)
        stored.add(value);
      for (const value of stored) {
        expect(read(String(value)), `${name} ${value}`).toBe(value);
      }
    }
  });
});
