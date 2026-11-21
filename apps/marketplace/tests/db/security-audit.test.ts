import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createUser,
  deleteUser,
  seed,
  serviceClient,
  signedInClient,
  type Db,
} from "./helpers";
import { KEPT_MAPS_URLS, REFUSED_MAPS_URLS } from "../../lib/maps-url.cases";

/**
 * The marketplace findings of the 19 Nov 2026 security audit
 * (20261120000100_marketplace_security_audit.sql). Each test here failed on
 * the schema as it stood before that migration.
 */

const DENIED = "42501";
const CHECK = "23514";

/** SQL straight in this checkout's local database, as its superuser. */
function psql(statements: string): Promise<{ out: string; failed: string }> {
  const config = readFileSync(
    fileURLToPath(new URL("../../../../supabase/config.toml", import.meta.url)),
    "utf8",
  );
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  return new Promise((resolve) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", (error) => resolve({ out, failed: String(error) }));
    child.on("close", (code) =>
      resolve({ out: out.trim(), failed: code === 0 ? "" : err || "failed" }),
    );
    child.stdin.end(statements);
  });
}

let anon: Db;
let service: Db;
let bsrOwner: Db;
let draftOwner: Db;
let stranger: { id: string; email: string };
let newcomer: { id: string; email: string };
const madeShops: string[] = [];
const madeUsers: string[] = [];

beforeAll(async () => {
  anon = anonClient();
  service = serviceClient();
  stranger = await createUser("audit-stranger");
  newcomer = await createUser("audit-newcomer");
  madeUsers.push(stranger.id, newcomer.id);
  [bsrOwner, draftOwner] = await Promise.all([
    signedInClient(seed.users.bsrOwner),
    signedInClient(seed.users.draftOwner),
  ]);
  // The draft shop's model gets one price, so that "no answer" below is the
  // rule and not an empty table.
  const { error } = await service
    .from("price_days")
    .upsert({ bike_model_id: seed.draftModel, day: 1, total: 250 });
  if (error) throw error;
});

afterAll(async () => {
  await service.from("price_days").delete().eq("bike_model_id", seed.draftModel);
  for (const id of madeShops) await service.from("shops").delete().eq("id", id);
  for (const id of madeUsers) await deleteUser(id);
});

describe("M1: nobody adds a shop member by writing the table", () => {
  it("an owner can't make an unrelated user a member of their shop", async () => {
    const { error } = await bsrOwner
      .from("shop_members")
      .insert({ shop_id: seed.bsrShop, user_id: stranger.id, role: "staff" });
    expect(error?.code).toBe(DENIED);
    // ...and so can't read that user's profile as a "teammate".
    const { data } = await bsrOwner
      .from("profiles")
      .select("id, email")
      .eq("id", stranger.id);
    expect(data).toEqual([]);
    const { data: members } = await service
      .from("shop_members")
      .select("user_id")
      .eq("user_id", stranger.id);
    expect(members).toEqual([]);
  });

  it("an owner can't add a second owner either", async () => {
    const { error } = await bsrOwner
      .from("shop_members")
      .insert({ shop_id: seed.bsrShop, user_id: stranger.id, role: "owner" });
    expect(error?.code).toBe(DENIED);
  });

  it("the grant is gone and so is the policy", async () => {
    const { out } = await psql(`
      select has_table_privilege('authenticated', 'public.shop_members', 'insert'),
             has_table_privilege('anon', 'public.shop_members', 'insert'),
             (select count(*) from pg_policy
               where polrelid = 'public.shop_members'::regclass and polcmd = 'a');
    `);
    expect(out).toBe("f|f|0");
  });

  it("create_shop() still makes its caller the owner", async () => {
    const client = await signedInClient(newcomer.email);
    const { data: shopId, error } = await client.rpc("create_shop", {
      p_name: "Audit Test Rentals",
    });
    expect(error).toBeNull();
    madeShops.push(shopId!);
    const { data } = await service
      .from("shop_members")
      .select("user_id, role")
      .eq("shop_id", shopId!);
    expect(data).toEqual([{ user_id: newcomer.id, role: "owner" }]);
  });

  it("accept_shop_invite() still adds the invited person as staff", async () => {
    const { data: token, error: inviteError } = await bsrOwner.rpc(
      "create_shop_invite",
      { p_shop_id: seed.bsrShop },
    );
    expect(inviteError).toBeNull();
    const invited = await createUser("audit-invited");
    madeUsers.push(invited.id);
    const client = await signedInClient(invited.email);
    const { data: joined, error } = await client.rpc("accept_shop_invite", {
      p_token: token!,
    });
    expect(error).toBeNull();
    expect(joined).toBe(seed.bsrShop);
    const { data } = await service
      .from("shop_members")
      .select("role")
      .eq("shop_id", seed.bsrShop)
      .eq("user_id", invited.id);
    expect(data).toEqual([{ role: "staff" }]);
  });
});

describe("the search functions answer for live shops only", () => {
  const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 5 * 86_400_000).toISOString();

  it("a signed-out visitor gets a live shop's numbers", async () => {
    const price = await anon.rpc("rental_price", {
      p_bike_model_id: seed.bsrPcx,
      p_days: 1,
    });
    expect(price.data).toBeGreaterThan(0);
    const offer = await anon.rpc("model_offer", {
      p_bike_model_id: seed.bsrPcx,
      p_start: start,
      p_end: end,
    });
    expect(offer.data).toHaveLength(1);
    const stats = await anon.rpc("shop_stats", { p_shop_id: seed.bsrShop });
    expect(stats.data).toHaveLength(1);
  });

  it("a signed-out visitor gets nothing about a shop that is not live", async () => {
    const price = await anon.rpc("rental_price", {
      p_bike_model_id: seed.draftModel,
      p_days: 1,
    });
    expect(price.error).toBeNull();
    expect(price.data).toBeNull();
    const offer = await anon.rpc("model_offer", {
      p_bike_model_id: seed.draftModel,
      p_start: start,
      p_end: end,
    });
    expect(offer.data).toEqual([]);
    const walkin = await anon.rpc("longest_walkin", {
      p_bike_model_id: seed.draftModel,
      p_start: start,
    });
    expect(walkin.data).toBe(0);
    const stats = await anon.rpc("shop_stats", { p_shop_id: seed.draftShop });
    expect(stats.data).toEqual([]);
  });

  it("another shop's owner gets nothing about it either", async () => {
    const price = await bsrOwner.rpc("rental_price", {
      p_bike_model_id: seed.draftModel,
      p_days: 1,
    });
    expect(price.data).toBeNull();
    const stats = await bsrOwner.rpc("shop_stats", {
      p_shop_id: seed.draftShop,
    });
    expect(stats.data).toEqual([]);
  });

  it("the draft shop's own owner and the server still get its numbers", async () => {
    for (const client of [draftOwner, service]) {
      const price = await client.rpc("rental_price", {
        p_bike_model_id: seed.draftModel,
        p_days: 1,
      });
      expect(price.data).toBe(250);
      const offer = await client.rpc("model_offer", {
        p_bike_model_id: seed.draftModel,
        p_start: start,
        p_end: end,
      });
      expect(offer.data).toHaveLength(1);
      const stats = await client.rpc("shop_stats", {
        p_shop_id: seed.draftShop,
      });
      expect(stats.data).toHaveLength(1);
    }
  });

  it("longest_walkin() looks no further than 90 days, whatever it is asked", async () => {
    // A model nothing is booked on: free for as long as anyone asks.
    const free = "c0000000-0000-4000-8000-000000000041";
    const asked = await anon.rpc("longest_walkin", {
      p_bike_model_id: free,
      p_start: start,
      p_max_days: 100000,
    });
    expect(asked.error).toBeNull();
    expect(asked.data).toBe(90);
    const negative = await anon.rpc("longest_walkin", {
      p_bike_model_id: free,
      p_start: start,
      p_max_days: -5,
    });
    expect(negative.data).toBe(0);
  }, 60_000);
});

describe("a shop's map link and photos", () => {
  const update = (
    client: Db,
    values: { maps_url?: string | null; photos?: string[] },
  ) =>
    client.from("shops").update(values).eq("id", seed.bsrShop).select("id");

  // The same rows run against safeMapsUrl() in lib/validation/maps-url.test.ts.
  it.each(REFUSED_MAPS_URLS)(
    "the owner can't save the map link %s",
    async (maps_url) => {
      const { error } = await update(bsrOwner, { maps_url });
      expect(error?.code).toBe(CHECK);
    },
  );

  it("a map link longer than 500 characters is refused", async () => {
    const long = "https://www.google.com/maps/place/" + "a".repeat(467);
    const { error } = await update(bsrOwner, { maps_url: long });
    expect(error?.code).toBe(CHECK);
  });

  it.each([
    "//evil.example/x.png",
    "https://evil.example/x.png",
    "/images/../../x",
    `${seed.draftShop}/x.webp`,
    `${seed.bsrShop}/../x.webp`,
    `${seed.bsrShop}/a/b.webp`,
  ])("the owner can't save the photo %s", async (photo) => {
    const { error } = await update(bsrOwner, { photos: [photo] });
    expect(error?.code).toBe(CHECK);
  });

  it("a model's photos are held to the same rule", async () => {
    for (const photo of [
      "//evil.example/x.png",
      `${seed.bsrShop}/x.webp`,
      `${seed.draftShop}/${seed.bsrPcx}/x.webp`,
    ]) {
      const { error } = await bsrOwner
        .from("bike_models")
        .update({ photos: [photo] })
        .eq("id", seed.bsrPcx)
        .select("id");
      expect(error?.code, photo).toBe(CHECK);
    }
  });

  it("Google Maps links, the shop's own files and our placeholders are saved", async () => {
    const { data: before } = await service
      .from("shops")
      .select("maps_url, photos")
      .eq("id", seed.bsrShop)
      .single();
    try {
      for (const maps_url of [...KEPT_MAPS_URLS, null]) {
        const { error } = await update(bsrOwner, { maps_url });
        expect(error, String(maps_url)).toBeNull();
      }
      const { error } = await update(bsrOwner, {
        photos: [
          "/images/placeholder-shop.svg",
          `${seed.bsrShop}/front door 1.webp`,
        ],
      });
      expect(error).toBeNull();
      const model = await bsrOwner
        .from("bike_models")
        .update({
          photos: [
            "/images/placeholder-bike.svg",
            `${seed.bsrShop}/${seed.bsrPcx}/side.webp`,
          ],
        })
        .eq("id", seed.bsrPcx)
        .select("id");
      expect(model.error).toBeNull();
    } finally {
      await service.from("shops").update(before!).eq("id", seed.bsrShop);
      await service
        .from("bike_models")
        .update({ photos: ["/images/placeholder-bike.svg"] })
        .eq("id", seed.bsrPcx);
    }
  });

  it("a row that held something else before the rule can still be changed elsewhere", async () => {
    // As on a database with older rows: put a link in with the rule switched
    // off for this one statement, then change another column.
    const set = await psql(`
      begin;
      set local session_replication_role = replica;
      update public.shops set maps_url = 'https://example.com/old-link'
      where id = '${seed.draftShop}';
      commit;
    `);
    expect(set.failed).toBe("");
    try {
      const { error } = await draftOwner
        .from("shops")
        .update({ about: "Still editable." })
        .eq("id", seed.draftShop)
        .select("id");
      expect(error).toBeNull();
    } finally {
      await service
        .from("shops")
        .update({ maps_url: null, about: null })
        .eq("id", seed.draftShop);
    }
  });
});

describe("two owners removing each other at the same moment", () => {
  it("one of them stays", async () => {
    const [a, b] = await Promise.all([
      createUser("audit-owner-a"),
      createUser("audit-owner-b"),
    ]);
    madeUsers.push(a.id, b.id);
    const { data: shop, error } = await service
      .from("shops")
      .insert({ name: "Audit Two Owners", slug: `audit-two-owners-${Date.now()}` })
      .select("id")
      .single();
    if (error) throw error;
    madeShops.push(shop.id);
    const added = await service.from("shop_members").insert([
      { shop_id: shop.id, user_id: a.id, role: "owner" },
      { shop_id: shop.id, user_id: b.id, role: "owner" },
    ]);
    if (added.error) throw added.error;

    // Each session removes the other owner and keeps its transaction open
    // for a moment, so the two overlap whichever starts first.
    const remove = (userId: string) =>
      psql(`
        begin;
        delete from public.shop_members
        where shop_id = '${shop.id}' and user_id = '${userId}';
        select pg_sleep(1.5);
        commit;
      `);
    const results = await Promise.all([remove(a.id), remove(b.id)]);

    const { data: left } = await service
      .from("shop_members")
      .select("user_id")
      .eq("shop_id", shop.id)
      .eq("role", "owner");
    expect(left).toHaveLength(1);
    const refused = results.filter((r) => r.failed !== "");
    expect(refused).toHaveLength(1);
    expect(refused[0].failed).toContain("a shop must keep at least one owner");
  }, 30_000);
});

describe("a booking's Stripe ids", () => {
  it("neither the shop nor the customer reads them; the rest of the row is read as before; the server reads everything", async () => {
    const customer = await signedInClient(seed.users.customer);
    for (const client of [bsrOwner, customer]) {
      for (const column of ["stripe_customer_id", "stripe_payment_method_id"]) {
        const { error } = await client
          .from("bookings")
          .select(`id, ${column}`)
          .eq("id", seed.booking);
        expect(error?.code, column).toBe(DENIED);
      }
      const { data, error } = await client
        .from("bookings")
        .select("id, code, status, fee, due_at_shop, currency, customer_id")
        .eq("id", seed.booking);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
    const all = await service
      .from("bookings")
      .select("id, stripe_customer_id, stripe_payment_method_id")
      .eq("id", seed.booking);
    expect(all.error).toBeNull();
    expect(all.data).toHaveLength(1);
    expect((await anon.from("bookings").select("id")).data).toEqual([]);
    // "*" names the closed columns too, so it is refused for everyone but
    // the server.
    expect((await bsrOwner.from("bookings").select("*")).error?.code).toBe(
      DENIED,
    );
  });
});
