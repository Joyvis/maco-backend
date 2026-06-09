<!-- BEGIN:single-source-of-truth -->

# Single source of truth for behavior

The backend is the **canonical owner** of business behavior. The frontend renders; it does not recompute. This applies to price/total calculations, timezone math, validation rules, refund/discount policy, slot resolution, and any business rule that affects persisted state.

- **One helper/class per concern.** Sale-order totals → one pricing helper. Timezone/time math → one helper. Combo pricing already follows this (`combo-pricing.helper.ts`); extend the pattern instead of inlining `price * qty` in a handler. Before adding calculation logic to a handler/service/controller, search for an existing helper — if logic appears in 2+ places, consolidate before adding a third copy.
- **Mutating endpoints must return recomputed state.** Any endpoint that adds/removes/changes a cart item, applies a discount, or reschedules a booking must return the canonical totals (and the relevant timestamps) in the response, so the frontend never has to derive them. Do not rely on the client to re-fetch.
- **Timezone**: persist UTC. Convert to/from wall-clock at the edge using the tenant's `TenantConfig.timezone`. Never read `process.env.TZ`, hardcode an offset, or do `new Date(...)` arithmetic scattered across services — funnel it through the shared helper.
- **Validation**: business-rule validation lives in the domain layer (service/command-handler), not duplicated in controllers and DTOs. DTOs cover shape; the domain enforces invariants.
- **Cross-cutting policies** (refund windows, cancellation rules, qualification checks) live in one owner and are called from every code path that needs them — never re-implemented per endpoint.

When you spot duplicated logic that should be centralized — flag it and consolidate, don't mirror it.

<!-- END:single-source-of-truth -->
