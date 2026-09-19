# Admin insurance premium Checkout links

`/admin/payment-links` (Payments → Payment Link) is restricted to administrators. The UI action remains **Create Payment Link**, but the implementation creates a single-use Stripe-hosted Checkout Session in `payment` mode, not a Stripe Payment Link. It collects pass-through premiums for Adler & Rochefort (Ownizo Unipessoal Lda), for subsequent remittance to insurers. It does not automate remittance or issue service invoices.

## Configuration and rollout

Apply `migrations/20260919_premium_payments.sql` to the intended Supabase database **before** enabling the feature. The migration has not been applied to a remote database by this PR. It follows the repository's dated SQL migration convention and is additive.

Set these three server-only variables in each environment:

| Variable | Development/test | Production |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Test credential | Live credential |
| `STRIPE_INSURANCE_PREMIUM_PRODUCT_ID` | `prod_VHukk4H9WtEYWh` | `prod_VHukIf4wWcTtbT` |
| `STRIPE_WEBHOOK_SECRET` | Test endpoint / local listener signing secret | Live endpoint signing secret |

No Stripe secret may have a `VITE_` prefix. Keep credentials in the host's environment settings, not source control. Existing Supabase configuration remains required: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `VITE_SUPABASE_ANON_KEY` for existing browser authentication. The new table is accessible only by the server service role; neither anonymous nor authenticated browser clients receive table grants. Server functions reuse the existing admin-role middleware.

In Stripe Dashboard / Workbench:

1. Enable compatible payment methods in the account's payment-method configuration. The code omits `payment_method_types`, so Stripe dynamically chooses eligible methods. Cards, Apple Pay, Google Pay, Link, MB WAY, Multibanco, and SEPA Direct Debit depend on account activation, currency/amount, customer location, browser/device, and Stripe eligibility; they are not guaranteed to appear for every checkout.
2. Register a snapshot webhook destination at `https://admin.adlerrochefort.com/api/stripe-webhook` after deployment, separately for live and test environments. Subscribe to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.processing`
3. Set the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`. Use the account's own events (not Connect events); use the SDK's API version for snapshot delivery when available (`node_modules/stripe/esm/apiVersion.js`).
4. Verify a test-mode Checkout, including a successful card payment, a declined payment/retry, a delayed-method pending → paid/failed flow, expiration, and webhook delivery/retries before enabling live credentials.

For local testing, forward events with `stripe listen --forward-to localhost:3000/api/stripe-webhook` and use that listener's signing secret. The endpoint accepts POST and verifies Stripe's signature against the **raw request body**. Invalid/missing signatures return 400. Missing configuration returns 503. Failed persistence or Stripe reads return 500 so Stripe retries. Unrelated events are acknowledged without changes.

## Exact premium and Checkout behavior

Amounts accept a point or comma and up to two decimals, without grouping separators. Integer conversion makes `1248.36` exactly `124836` cents. Amounts must be positive and fit Stripe's eight-digit amount limit. Stripe can reject values below a payment method's minimum; the amount is never increased automatically.

Each attempt creates a one-time EUR Price on the configured existing product and a hosted Checkout Session with `mode: payment`, `currency: eur`, one fixed quantity, `adaptive_pricing.enabled: false`, `automatic_tax.enabled: false`, `invoice_creation.enabled: false`, and promotion codes disabled. No discounts, taxes, shipping, surcharges, application fees, subscription parameters, or customer fee additions are supplied. Dynamic Payment Methods stay enabled. Stripe's merchant processing cost does not alter the EUR premium.

`customer_email` prefills Checkout directly. Session and PaymentIntent metadata contain purpose, customer name/email, insurer, policy reference, authenticated admin ID, and the internal premium payment UUID.

Success returns to the **current request origin** plus `/admin/payment-links?session_id={CHECKOUT_SESSION_ID}`; cancellation returns to `/admin/payment-links?cancelled=1`. These are admin routes as requested: a signed-out policyholder sees the existing login flow. Neither returning to these URLs nor presenting a session ID proves payment. An authenticated admin status lookup validates the session against a stored premium and reads Stripe server-side. Cancellation does not cancel the session; an open link remains usable until completion or expiration (Stripe's default is 24 hours).

## Persistence, retries, and status

`premium_payments` stores the premium details, authenticated creator, mode, unique Stripe Session/PaymentIntent IDs, Checkout URL, status, timestamps, creation request key/fingerprint, and concurrency version. A reservation is committed before Stripe object creation. Creation failure can leave a reserved `created` row with no session ID; this is an unresolved creation attempt, not proof that a usable link exists.

A UUID identifies a form operation. Price and Session calls use distinct, stable Stripe idempotency keys scoped to the admin. Same-details retries recover the stored session without creating another; an uncertain response uses the same Stripe keys. Changed details with the same key are rejected. After 23 hours, an unresolved creation attempt is refused because Stripe retains keys for at least 24 hours. Reconcile such an attempt in Stripe before deliberately creating a new link. Reloading the form or choosing “Create another link” starts a new operation; this is not policy-level deduplication.

| Status | Meaning |
| --- | --- |
| Created | Checkout open; payment not confirmed (or a reserved creation attempt has no session yet) |
| Pending | Checkout completed but unpaid, or PaymentIntent processing; wait for settlement |
| Paid | Stripe confirms settlement with the matching EUR amount |
| Failed | PaymentIntent canceled or failed; a still-open Checkout may allow a retry |
| Expired | Checkout expired without a confirmed or processing payment |

All handled events trigger retrieval of the current Checkout Session with expanded PaymentIntent. This avoids trusting stale event snapshots. `checkout.session.completed` with unpaid status is **not** payment success. Amount, currency, mode, environment, and internal/Stripe identifiers are checked before persistence. Early PaymentIntent webhooks resolve the corresponding Checkout Session through Stripe and can attach it to the reserved row.

Database compare-and-swap updates use the version column. A conflict re-reads both the row and Stripe; `paid` cannot be downgraded by older events or concurrent status refreshes. `paid_at` records the first server-confirmed settlement observation. Repeated events are safe without a second event-log table. This feature does not track refunds/disputes or insurer remittances. The admin result refreshes from the server every 15 seconds while open.

## Verification

- `npm test` covers decimal conversion, input validation, exact Checkout parameters, metadata/email, retry keys and partial failures, old-attempt rejection, signature verification, delayed status transitions, duplicate/stale/early events, expiry and database-error retries using a stub Stripe client/store.
- `npm run build` verifies both client and server bundles. Stripe secrets and server implementation must be absent from the client bundle.
- `npx tsc --noEmit` must introduce no errors relative to the existing branch baseline.
- The migration was executed in isolated PostgreSQL via PGlite, testing constraints, unique identifiers, stale-write rejection, RLS/client-role denial, service-role access and deleted-admin preservation. No production database or Stripe account was mutated.

References: [Checkout API](https://docs.stripe.com/api/checkout/sessions/create), [webhook signatures and delivery](https://docs.stripe.com/webhooks), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
