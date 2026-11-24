import { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { atMostOne, exactlyOne } from "./rows";

type Row = { id: string };

/** A stand-in for a query: a thenable answering like supabase-js does. */
function query(data: unknown, { throwOnError = false } = {}) {
  const response = {
    success: true as const,
    error: null,
    data: data as Row[],
    count: null,
    status: 200,
    statusText: "OK",
  };
  return {
    shouldThrowOnError: throwOnError,
    then<A, B>(
      ok?: ((value: typeof response) => A | PromiseLike<A>) | null,
      fail?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ) {
      return Promise.resolve(response).then(ok, fail);
    },
  };
}

const queryError = {
  code: "42501",
  details: "",
  hint: "",
  message: "permission denied for table shops",
} as unknown as PostgrestError;

function failing() {
  return Promise.resolve({
    success: false as const,
    error: queryError,
    data: null,
    count: null,
    status: 403,
    statusText: "Forbidden",
  });
}

const a = { id: "a" };
const b = { id: "b" };

describe("exactlyOne", () => {
  it("returns the row when there is one", async () => {
    expect(await exactlyOne(query([a]))).toEqual({
      success: true,
      error: null,
      data: a,
      count: null,
      status: 200,
      statusText: "OK",
    });
  });

  it("is PGRST116 for no rows, as .single() is", async () => {
    expect(await exactlyOne(query([]))).toEqual({
      success: false,
      error: {
        code: "PGRST116",
        details: "The result contains 0 rows",
        hint: null,
        message: "Cannot coerce the result to a single JSON object",
      },
      data: null,
      count: null,
      status: 406,
      statusText: "Not Acceptable",
    });
  });

  it("is PGRST116 for several rows", async () => {
    const { data, error, status } = await exactlyOne(query([a, b]));
    expect(data).toBeNull();
    expect(error).toMatchObject({
      code: "PGRST116",
      details: "The result contains 2 rows",
    });
    expect(status).toBe(406);
  });

  it("passes a query's own error through unchanged", async () => {
    const response = await exactlyOne(failing());
    expect(response.error).toBe(queryError);
    expect(response.status).toBe(403);
  });

  it("takes a function's single value (not a set) as one row", async () => {
    expect((await exactlyOne(query(a))).data).toEqual(a);
    const none = (await exactlyOne(query(null))) as {
      error: { code: string } | null;
    };
    expect(none.error?.code).toBe("PGRST116");
  });

  it("throws on a wrong count when the query was built with .throwOnError()", async () => {
    const thrown = exactlyOne(query([], { throwOnError: true }));
    await expect(thrown).rejects.toBeInstanceOf(PostgrestError);
    await expect(thrown).rejects.toMatchObject({ code: "PGRST116", hint: "" });
    expect((await exactlyOne(query([a], { throwOnError: true }))).data).toEqual(
      a,
    );
  });
});

describe("atMostOne", () => {
  it("returns the row when there is one", async () => {
    expect((await atMostOne(query([a]))).data).toEqual(a);
  });

  it("returns null and no error for no rows, as .maybeSingle() does", async () => {
    expect(await atMostOne(query([]))).toEqual({
      success: true,
      error: null,
      data: null,
      count: null,
      status: 200,
      statusText: "OK",
    });
  });

  it("is PGRST116 for several rows, as .maybeSingle() is", async () => {
    expect(await atMostOne(query([a, b]))).toEqual({
      success: false,
      error: {
        code: "PGRST116",
        details:
          "Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row",
        hint: null,
        message: "JSON object requested, multiple (or no) rows returned",
      },
      data: null,
      count: null,
      status: 406,
      statusText: "Not Acceptable",
    });
  });

  it("passes a query's own error through unchanged", async () => {
    const response = await atMostOne(failing());
    expect(response.error).toBe(queryError);
    expect(response.status).toBe(403);
  });

  it("throws on several rows when the query was built with .throwOnError()", async () => {
    await expect(
      atMostOne(query([a, b], { throwOnError: true })),
    ).rejects.toMatchObject({ code: "PGRST116" });
    expect(
      (await atMostOne(query([], { throwOnError: true }))).data,
    ).toBeNull();
  });
});
