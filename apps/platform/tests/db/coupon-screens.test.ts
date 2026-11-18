/**
 * Phase 2, stage 9 (review of PR 50): Settings › Coupons' "Bring back"
 * racing a new coupon with the same code, through the screens' own save
 * path (lib/coupon-save.ts' saveCoupon(), the one caller of save_coupon()).
 * An archived code may be used again, and an archived coupon may be
 * brought back, but two live coupons can never share a code: whichever
 * save lands first wins, every other one is answered `code_taken` with
 * nothing written, and exactly one live coupon has the code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveCoupon, type CouponSaveDb } from "@/lib/coupon-save";
import {
  createTenant,
  deleteTenant,
  serviceClient,
  type TestTenant,
} from "./helpers";

let shop: TestTenant;
const service = serviceClient();
const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
const ROUNDS = 10;

const as = (role: "owner" | "manager") =>
  shop.members[role].db as unknown as CouponSaveDb;

beforeAll(async () => {
  shop = await createTenant("coupon-screens", {
    country: "TH",
    currency: "THB",
    locale: "th-TH",
    timezone: "Asia/Bangkok",
  });
}, 60_000);

afterAll(async () => {
  await deleteTenant(shop);
}, 60_000);

describe("Bring back racing a create of the same code", () => {
  it(`one save wins, the rest are code_taken, and one live coupon has the code (${ROUNDS} rounds)`, async () => {
    const winners: Record<string, number> = {};
    for (let round = 0; round < ROUNDS; round++) {
      const code = `RACE${tag}${round}`;
      // A coupon with the code, archived: its code is free again.
      const first = await saveCoupon(as("owner"), shop.id, {
        code,
        kind: "percent",
        percent_bp: 1000,
        channels: ["staff"],
      });
      if (!first.ok) throw new Error(first.reason);
      const archived = await saveCoupon(as("owner"), shop.id, {
        id: first.coupon.id,
        archived: true,
      });
      expect(archived.ok).toBe(true);

      // Bring it back, while a manager and the owner each create a coupon
      // with the same code, all at once.
      const fresh = {
        code: code.toLowerCase(),
        kind: "fixed" as const,
        amount: "20000",
        channels: ["staff" as const],
      };
      const answers = await Promise.all([
        saveCoupon(as("owner"), shop.id, {
          id: first.coupon.id,
          archived: false,
          code,
        }),
        saveCoupon(as("manager"), shop.id, fresh),
        saveCoupon(as("owner"), shop.id, fresh),
      ]);
      const ok = answers.filter((a) => a.ok);
      expect(ok, `round ${round}`).toHaveLength(1);
      for (const answer of answers)
        if (!answer.ok)
          expect(answer.reason, `round ${round}`).toBe("code_taken");
      const winner = answers.findIndex((a) => a.ok);
      const label = ["bring back", "manager's create", "owner's create"][
        winner
      ];
      winners[label] = (winners[label] ?? 0) + 1;

      // Exactly one live coupon has the code; nothing else was written.
      const { data, error } = await service
        .from("coupons")
        .select("id, archived_at")
        .eq("tenant_id", shop.id)
        .eq("code", code);
      if (error) throw error;
      const live = data.filter((row) => row.archived_at === null);
      expect(live, `round ${round}`).toHaveLength(1);
      expect(data, `round ${round}`).toHaveLength(winner === 0 ? 1 : 2);
      if (winner === 0) expect(live[0].id).toBe(first.coupon.id);
    }
    // The order the saves landed in, for the report.
    console.info("Bring back racing creates, winners:", winners);
  }, 120_000);
});
