# @mango/core

Pure TypeScript rules shared by the apps: rental days, day-table pricing,
availability maths, closures, money and time. No React, Next.js or Supabase
(ESLint enforces this). Import one module at a time:

```ts
import { rentalDays } from "@mango/core/rental-days";
import { formatBaht } from "@mango/core/money";
```

Pricing for the platform (docs/products-redesign.md §9) is currency-neutral and
in `bigint` minor units: `price-list` (quick entry, the two kinds of list),
`rental-price` (the list price of one unit for one rental), `season`, `quote`
(**the one pricer**: seasons, discounts, VAT per invoice, deposits),
`rental-period` (extending, swapping and returning early) and `zoned`
(wall-clock time in any time zone). `pricing` and `money` are the
marketplace's whole-baht versions and stay until 3M.

Every function here is unit-tested (`npm test -w @mango/core`). Moved unchanged
from the marketplace's `lib/` in Step R; the Bangkok-only and whole-baht parts
are listed in `docs/PROGRESS.md` for platform Phase 2.
