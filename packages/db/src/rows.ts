import {
  PostgrestError,
  type PostgrestMaybeSingleResponse,
  type PostgrestResponse,
  type PostgrestSingleResponse,
} from "@supabase/supabase-js";

/**
 * Use these instead of `.single()` and `.maybeSingle()` (ESLint bans those
 * outside this package). Both count the rows themselves rather than trusting
 * the database API to do it: Neon's Data API, where the database moves after
 * Phase 3, gives no error from `.single()` when zero or several rows match,
 * while Supabase answers PGRST116. Today they return exactly what Supabase's
 * `.single()` and `.maybeSingle()` return, error shape included, so callers'
 * error handling is unchanged.
 *
 *   const { data, error } = await exactlyOne(
 *     supabase.from("shops").select("id").eq("id", shopId),
 *   );
 *
 * One difference from `.single()` on a write: PostgREST rolls an insert,
 * update or delete back when it touches other than one row; these helpers
 * report the error after the write has landed. Only use them on writes that
 * can touch one row at most (by primary key, or a one-row insert).
 *
 * A query that ends in `.throwOnError()` keeps it: a wrong row count then
 * throws, as `.single().throwOnError()` did.
 */

/** A successful answer (supabase-js doesn't export this type by name). */
type PostgrestResponseSuccess<T> = Extract<
  PostgrestSingleResponse<T>,
  { error: null }
>;

/** Any query that has not been made single: it answers with rows. */
type RowsQuery<T> = PromiseLike<PostgrestResponse<T>>;
/** The same query after `.throwOnError()`. */
type ThrowingRowsQuery<T> = PromiseLike<PostgrestResponseSuccess<T[]>>;

/** Exactly one row, or the error `.single()` gives (PGRST116) for 0 or 2+. */
export function exactlyOne<T>(
  query: ThrowingRowsQuery<T>,
): Promise<PostgrestResponseSuccess<T>>;
export function exactlyOne<T>(
  query: RowsQuery<T>,
): Promise<PostgrestSingleResponse<T>>;
export async function exactlyOne<T>(
  query: RowsQuery<T>,
): Promise<PostgrestSingleResponse<T>> {
  const response = await query;
  if (response.error) return response;
  const rows = asRows(response.data);
  if (rows.length === 1) return { ...response, data: rows[0] as T };
  // What PostgREST answers to `.single()` (406, PGRST116).
  return failure(query, {
    code: "PGRST116",
    details: `The result contains ${rows.length} rows`,
    hint: null,
    message: "Cannot coerce the result to a single JSON object",
  });
}

/** Zero or one row (`data: null` for none); several is the error `.maybeSingle()` gives. */
export function atMostOne<T>(
  query: ThrowingRowsQuery<T>,
): Promise<PostgrestResponseSuccess<T | null>>;
export function atMostOne<T>(
  query: RowsQuery<T>,
): Promise<PostgrestMaybeSingleResponse<T>>;
export async function atMostOne<T>(
  query: RowsQuery<T>,
): Promise<PostgrestMaybeSingleResponse<T>> {
  const response = await query;
  if (response.error) return response;
  const rows = asRows(response.data);
  if (rows.length <= 1)
    return { ...response, data: (rows[0] ?? null) as T | null };
  // What supabase-js's `.maybeSingle()` answers (406, PGRST116).
  return failure(query, {
    code: "PGRST116",
    details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
    hint: null,
    message: "JSON object requested, multiple (or no) rows returned",
  });
}

/**
 * The rows of an answer. A function that returns one value rather than a set
 * answers with that value, not an array; `.single()` took it as one row.
 */
function asRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  return data === null || data === undefined ? [] : [data];
}

type ErrorFields = {
  code: string;
  details: string;
  hint: null;
  message: string;
};

function failure(
  query: unknown,
  fields: ErrorFields,
): PostgrestSingleResponse<never> {
  if (throwsOnError(query)) {
    // As supabase-js throws it: its own error class, a missing hint as "".
    throw new PostgrestError({ ...fields, hint: "" });
  }
  return {
    success: false,
    // Supabase sends these as plain objects with `hint: null`, not as the
    // PostgrestError class its types name; kept so for identical behaviour.
    error: fields as unknown as PostgrestError,
    data: null,
    count: null,
    status: 406,
    statusText: "Not Acceptable",
  };
}

/** Whether the query was built with `.throwOnError()`. */
function throwsOnError(query: unknown): boolean {
  return (
    typeof query === "object" &&
    query !== null &&
    (query as { shouldThrowOnError?: unknown }).shouldThrowOnError === true
  );
}
