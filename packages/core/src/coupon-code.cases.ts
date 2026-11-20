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
    typed: "summer\u00a010",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "a zero-width space",
    typed: "summer\u200b10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "a zero-width joiner, a non-joiner and a word joiner",
    typed: "sum\u200dmer\u200c1\u20600",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "a byte order mark in front",
    typed: "\ufeffSUMMER10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "an ideographic space and a narrow no-break space",
    typed: "SUMMER\u3000\u202f10",
    normalized: "SUMMER10",
    accepted: true,
  },
  {
    what: "an en quad, a thin space and a hair space",
    typed: "\u2000SUMMER\u2009\u200a10",
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
    typed: " \u00a0\t ",
    normalized: "",
    accepted: false,
  },
  {
    what: "sharp s stays as it is: it is not SS",
    typed: "stra\u00dfe",
    normalized: "STRA\u00dfE",
    accepted: false,
  },
  {
    what: "full-width capitals become plain capitals",
    typed: "\uff33\uff35\uff2d\uff2d\uff25\uff32",
    normalized: "SUMMER",
    accepted: true,
  },
  {
    what: "full-width small letters become plain capitals",
    typed: "\uff53\uff55\uff4d\uff4d\uff45\uff52",
    normalized: "SUMMER",
    accepted: true,
  },
  {
    what: "full-width digits become plain digits",
    typed: "SAVE\uff12\uff10",
    normalized: "SAVE20",
    accepted: true,
  },
  {
    what: "full-width and plain mixed, with an ideographic space",
    typed: "\uff53ave\u3000\uff12\uff100",
    normalized: "SAVE200",
    accepted: true,
  },
  {
    what: "the ends of each full-width range: A, Z, a, z, 0 and 9",
    typed: "\uff21\uff3a\uff41\uff5a\uff10\uff19",
    normalized: "AZAZ09",
    accepted: true,
  },
  {
    what: "the characters either side of the full-width ranges are left alone",
    typed: "\uff20\uff3b\uff40\uff5b\uff0f\uff1a",
    normalized: "\uff20\uff3b\uff40\uff5b\uff0f\uff1a",
    accepted: false,
  },
  {
    what: "an accented letter is left as typed",
    typed: "\u00e9t\u00e9",
    normalized: "\u00e9T\u00e9",
    accepted: false,
  },
  {
    what: "a dotless i and a dotted capital I",
    typed: "\u0131stanbul\u0130",
    normalized: "\u0131STANBUL\u0130",
    accepted: false,
  },
  {
    what: "the fi ligature is not F and I",
    typed: "\ufb01rst",
    normalized: "\ufb01RST",
    accepted: false,
  },
  {
    what: "the Kelvin sign is not K",
    typed: "\u212a10",
    normalized: "\u212a10",
    accepted: false,
  },
  {
    what: "Greek and Cyrillic look-alikes",
    typed: "\u0391\u0412C",
    normalized: "\u0391\u0412C",
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
    typed: "summer\u201110",
    normalized: "SUMMER\u201110",
    accepted: false,
  },
  {
    what: "Thai",
    typed: "\u0e25\u0e14",
    normalized: "\u0e25\u0e14",
    accepted: false,
  },
  {
    what: "an emoji",
    typed: "sun\ud83c\udf1e",
    normalized: "SUN\ud83c\udf1e",
    accepted: false,
  },
  {
    what: "a quote and a semicolon",
    typed: "a';--",
    normalized: "A';--",
    accepted: false,
  },
];
