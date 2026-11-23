-- Neon spike: role wiring for the Data API, run once after the migrations. Idempotent.
-- Run as neondb_owner over the direct connection.

-- The Data API logs in as `authenticator` and does SET ROLE to the token's `role` claim.
-- Neon made `authenticated` and `anonymous` and granted them to authenticator. We made `anon` and
-- `service_role`, so we hold ADMIN on those two and can grant them on.
grant anon to authenticator;
grant service_role to authenticator;

-- Row 8, `anon` against `anonymous`: a request with no token runs as `anonymous`. Our 207 grants name
-- `anon`. Make `anonymous` a member of `anon` (it inherits), so it has exactly anon's rights.
grant anon to anonymous;

-- Timeouts on the two roles we own, to match what Neon put on its own roles (authenticated 8s, anonymous 3s).
alter role service_role set statement_timeout = '8s';
alter role anon set statement_timeout = '3s';
