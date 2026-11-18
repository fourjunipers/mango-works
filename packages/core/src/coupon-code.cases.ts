/**
 * A coupon code, as typed and as it is stored and compared.
 *
 * One list for both normalisers: normalizeCouponCode() in discounts.ts
 * (discounts.test.ts) and platform_private.normalize_coupon_code() in the
 * database (apps/platform/tests/db/coupons.test.ts). Both must give
 * "normalized" for "typed", character for character, and "accepted" says
 * whether save_coupon() takes it (A to Z and 0 to 9 only, 1 to 40).
 *
 * Characters that can't be seen are written as escapes.
 */
export type CouponCodeCase = {
  what: string;
  typed: string;
  normalized: string;
  accepted: boolean;
};

export const COUPON_CODE_CASES: readonly CouponCodeCase[] = [
  {
    what: "as stored",
    typed: "SAVE200",
    normalized: "SAVE200",
    accepted: true,
  },
  {
    what: "lower case",
    typed: "save200",
    normalized: "SAVE200",
    accepted: true,
  },
  {
    what: "mixed case",
    typed: "SaVe200",
    normalized: "SAVE200",
    accepted: true,
  },
  {
    what: "spaces and a tab",
    typed: "  save 200\t",
    normalized: "SAVE200",
    accepted: true,
  },
  {
    what: "line breaks",
    typed: "save\r\n200\n",
    normalized: "SAVE200",
    accepted: true,
  },
  {
    what: "a no-break space (NBSP)",
    typed: "summer 10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "a zero-width space",
    typed: "summer​10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "a zero-width joiner, a non-joiner and a word joiner",
    typed: "sum‍mer‌1⁠0",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "a byte order mark in front",
    typed: "﻿SUMMER10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "an ideographic space and a narrow no-break space",
    typed: "SUMMER　 10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "an en quad, a thin space and a hair space",
    typed: " SUMMER  10",
    normalized: "SUMMER10",
    accepted: true,
  },
  { what: "digits only", typed: "2027", normalized: "2027", accepted: true },
  {
    what: "40 characters",
    typed: "a".repeat(40),
    normalized: "A".repeat(40),
    accepted: true,
  },
  {
    what: "41 characters",
    typed: "a".repeat(41),
    normalized: "A".repeat(41),
    accepted: false,
  },
  { what: "nothing", typed: "", normalized: "", accepted: false },
  {
    what: "only spaces",
    typed: "  \t ",
    normalized: "",
    accepted: false,
  },
  {
    what: "sharp s stays as it is: it is not SS",
    typed: "straße",
    normalized: "STRAßE",
    accepted: false,
  },
  {
    what: "full-width capitals are not folded",
    typed: "ＳＵＭＭＥＲ",
    normalized: "ＳＵＭＭＥＲ",
    accepted: false,
  },
  {
    what: "full-width small letters are not made capitals",
    typed: "ｓｕｍｍｅｒ",
    normalized: "ｓｕｍｍｅｒ",
    accepted: false,
  },
  {
    what: "full-width digits",
    typed: "SAVE２０",
    normalized: "SAVE２０",
    accepted: false,
  },
  {
    what: "an accented letter is left as typed",
    typed: "été",
    normalized: "éTé",
    accepted: false,
  },
  {
    what: "a dotless i and a dotted capital I",
    typed: "ıstanbulİ",
    normalized: "ıSTANBULİ",
    accepted: false,
  },
  {
    what: "the fi ligature is not F and I",
    typed: "ﬁrst",
    normalized: "ﬁRST",
    accepted: false,
  },
  {
    what: "the Kelvin sign is not K",
    typed: "K10",
    normalized: "K10",
    accepted: false,
  },
  {
    what: "Greek and Cyrillic look-alikes",
    typed: "ΑВC",
    normalized: "ΑВC",
    accepted: false,
  },
  {
    what: "a hyphen",
    typed: "summer-10",
    normalized: "SUMMER-10",
    accepted: false,
  },
  {
    what: "an underscore",
    typed: "summer_10",
    normalized: "SUMMER_10",
    accepted: false,
  },
  {
    what: "a non-breaking hyphen",
    typed: "summer‑10",
    normalized: "SUMMER‑10",
    accepted: false,
  },
  {
    what: "Thai",
    typed: "ลด",
    normalized: "ลด",
    accepted: false,
  },
  {
    what: "an emoji",
    typed: "sun🌞",
    normalized: "SUN🌞",
    accepted: false,
  },
  {
    what: "a quote and a semicolon",
    typed: "a';--",
    normalized: "A';--",
    accepted: false,
  },
];
