---
name: feedback-grove-module-gotchas
description: Grove module/route gotchas hit while building the framing app — type system quirks that break at module load or invariant check
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b68cda0b-2d8a-4864-b970-02f6b439da86
---

Three Grove gotchas that bit me building the framing app on 2026-05-22. Each one produced a `Z3001` type error that took a re-test to localize. Future-me, watch for these when editing `modules/*/module.grove` files.

**1. Don't compare non-nullable params to `null` in `validate` blocks.**
```
// BREAKS module load: "types String and Null are not comparable"
validate ticket_no_present {
  params.ticket_no != null && params.ticket_no != ""
}

// OK — ticket_no is declared non-nullable, so the null check is redundant
validate ticket_no_present {
  params.ticket_no != ""
}
```
Grove's type checker rejects `String != null` when the type is non-nullable. Same for any other base type. Only do `!= null` on `Type?` (nullable) fields.

**2. `update` events overwrite record fields with null when params are null.**
The `update` action takes all-nullable params and emits an `updated` event. When applied, fields that are null in the event REPLACE the record's existing values with null. This breaks invariants like `record.balance_due >= 0` because the new value is null.
**Why:** The Grove runtime treats event payload as authoritative; there's no "skip null" semantic in the apply block.
**How to apply:** From the client, always send the FULL state on update calls. Build a helper that echoes back every field of the current record, then override the ones you want to change. See `fullOrderBody()` in `apps/main/assets/counter.js`.

**3. `Decimal == Int` is always false — use `<=` or `>=`.**
```
// BREAKS invariant check on a zeroed Decimal:
invariant pickup_paid { record.balance_due == 0 }   // fails when balance_due is "0.00"

// OK:
invariant pickup_paid { record.balance_due <= 0 }   // combined with >=0 elsewhere == zero
```
**Why:** Grove's `==` does strict type equality, and `Decimal == Int(0)` evaluates as a type mismatch returning false rather than mathematical equality. `Decimal > Int(0)` and `Decimal >= Int(0)` DO work (so the asymmetry is specific to `==`). Use ordered comparisons or compare Decimal to Decimal literals (untested whether `Decimal(0)` literal exists).
**How to apply:** When asserting "this Decimal is zero," combine `>= 0` (or `<= 0`) with a complementary invariant or with the natural lower/upper bound.
