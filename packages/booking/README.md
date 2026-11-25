# @mango/booking

Server-only booking code shared by the apps (docs/phase-3-plan.md, decision 15).

- `book-online`: `bookOnline()`, **the one entry point for online bookings**
  (`booking_page`, `marketplace`, `api`). It asks `offer()` in `@mango/core`
  first and only then calls `platform.create_order()` with the service role.
  `src/book-online.test.ts` walks both apps and every package and fails if any
  other file could be a path to `create_order()` for an online channel.
- `booking-inputs`, `pricing-inputs`, `coupons`: the reads it needs, turned
  into what `@mango/core` takes. The platform's staff path uses them too.
- `charges`: the charge `create_order()` stores, from a quote snapshot.
- `try-again`: which database errors mean "nothing was written, send it again".

No app imports and no `@/` alias (ESLint). Import one module at a time:

```ts
import { bookOnline } from "@mango/booking/book-online";
```
