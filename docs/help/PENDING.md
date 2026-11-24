# Pending article updates

Changes waiting on unmerged work. When the PR merges, update the articles listed, set their `updated` date, and delete the entry here.

## Quantity range message (branch `platform/quantity-range-message`)

A gear or item-for-sale quantity above the most (1,000 for gear, 100,000 for items for sale) will show `FormErrors.quantity_out_of_range` ("Enter a quantity from 0 to 1,000 (up to 100,000 for an item for sale).") instead of `invalidQuantity` ("Enter a whole number."). Words, decimals and negatives still show "Enter a whole number."

Articles to update once the help articles of PR 59 (`docs/help-more-screens`) and this change are both on `main`: `en/products/gear-stock-and-quantity.md` (drop "A number above 1,000 gives this message too." and add the range message), `en/products/item-for-sale-stock.md`, and `en/products/create-gear-or-service.md` (its "Enter a whole number." bullet).
