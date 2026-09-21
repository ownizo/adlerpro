# Admin insurance premium Checkout links

`/admin/payment-links` (Payments → Payment Link) is restricted to administrators. The UI action remains **Create Payment Link**, but the implementation creates a single-use Stripe-hosted Checkout Session in `payment` mode, not a Stripe Payment Link. It collects pass-through premiums for Adler & Rochefort (Ownizo Unipessoal Lda), for subsequent remittance to insurers. It does not automate remittance or issue service invoices.

## Configuration and rollout

Apply `migrations/20260919_premium_payments.sql`, then `migrations/20260921_premium_payment_methods_short_links.sql` to the intended Supabase database **before** enabling the feature. The migration has not been applied to a remote database by this PR. It follows the repository's dated SQL migration convention and is additive.

Set these three server-only variables in each environment:

| Variable | Development/test | Production |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Test credential | Live credential |
| `STRIPE_INSURANCE_PREMIUM_PRODUCT_ID` | `prod_VHukk4H9WtEYWh` | `prod_VHukIf4wWcTtbT` |
| `STRIPE_WEBHOOK_SECRET` | Test endpoint / local listener signing secret | Live endpoint signing secret |

No Stripe secret may have a `VITE_` prefix. Keep credentials in the host's environment settings, not source control. Existing Supabase configuration remains required: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `VITE_SUPABASE_ANON_KEY` for existing browser authentication. The table is accessible only by the server service role; neither anonymous nor authenticated browser clients receive table grants. Server functions reuse the existing admin-role middleware.

In Stripe Dashboard / Workbench:

1. Enable the selected methods in the Stripe account. Checkout explicitly allows only Admin-selected methods. Wallets depend on device and Stripe eligibility. Link is disabled, and no other methods are enabled by this integration.
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

Each attempt supplies inline `price_data.product_data` (name: `Insurance Premium`; description: separate Client, Email, Insurer, and Policy lines from validated input) and a hosted Checkout Session with `mode: payment`, `currency: eur`, one fixed quantity, `adaptive_pricing.enabled: false`, `automatic_tax.enabled: false`, `invoice_creation.enabled: false`, and promotion codes disabled. No discounts, taxes, shipping, surcharges, application fees, subscription parameters, or customer fee additions are supplied. The shared configured Product is retrieved only as an active/live-mode guard; it is never mutated. No standalone Price or Product creation call is made. Stripe's merchant processing cost does not alter the EUR premium.

An exact-email Stripe Customer is reused in the matching test/live environment or created, and its ID is passed to Checkout. The customer does not need a Stripe account. Session and PaymentIntent metadata contain purpose, customer name/email, insurer, policy reference, authenticated admin ID, and the internal premium payment UUID.

Success returns to the **current request origin** plus `/admin/payment-links?session_id={CHECKOUT_SESSION_ID}`; cancellation returns to `/admin/payment-links?cancelled=1`. These are admin routes as requested: a signed-out policyholder sees the existing login flow. Neither returning to these URLs nor presenting a session ID proves payment. An authenticated admin status lookup validates the session against a stored premium and reads Stripe server-side. Cancellation does not cancel the session; an open link remains usable until completion or expiration (Stripe's default is 24 hours).

## Persistence, retries, and status

`premium_payments` stores selected payment methods, the short code, premium details, authenticated creator, mode, unique Stripe Session/PaymentIntent IDs, Checkout URL, status, timestamps, creation request key/fingerprint, and concurrency version. A reservation is committed before Stripe object creation. Creation failure can leave a reserved `created` row with no session ID; this is an unresolved creation attempt, not proof that a usable link exists.

A UUID identifies a form operation. Customer and Session calls use distinct, stable Stripe idempotency keys scoped to the admin. Same-details retries recover the stored session without creating another; an uncertain response uses the same Stripe keys. Changed details with the same key are rejected. After 23 hours, an unresolved creation attempt is refused because Stripe retains keys for at least 24 hours. Reconcile such an attempt in Stripe before deliberately creating a new link. Reloading the form or choosing “Create another link” starts a new operation; this is not policy-level deduplication.

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

## Payment methods and short links

Admin defaults to **All methods**. Presets map to these exact canonical Stripe arrays:

| Preset | Stripe methods |
| --- | --- |
| All methods | `card`, `mb_way`, `revolut_pay`, `customer_balance`, `sepa_debit` |
| Bank Transfer + SEPA | `customer_balance`, `sepa_debit` |
| Bank Transfer only | `customer_balance` |
| SEPA Direct Debit only | `sepa_debit` |
| Card / Apple Pay / Google Pay | `card` |
| Custom | Independently selected subset in the All methods order |

At least one method is required. Server validation rejects unsupported values, duplicate values, and non-array input. The selected methods are persisted and included in the request fingerprint. Bank Transfer uses Customer balance with `funding_type: bank_transfer`, `type: eu_bank_transfer`, and `eu_bank_transfer.country: IE`, only when selected. Link's `display: never` wallet option is supplied only with card. SEPA uses Checkout's mandate flow. Bank Transfer awaiting funds and SEPA processing remain **Pending** until actual settlement; Checkout completion alone never means Paid. Existing webhook reconciliation remains authoritative.

Admin displays, copies, and opens the short URL, with a readable method summary. Raw Stripe Checkout URLs remain server-side in `checkout_url` and are not included in the Admin response. Both creation and status refresh reconstruct the short URL.

The additive 20260921 migration defaults/backfills methods to the full set and generates a unique 16-character base64url code per existing/new row. It uses 12 bytes of a fresh PostgreSQL random UUID (90 random bits after version/variant bits), not a raw UUID or internal ID. A UNIQUE constraint rejects collisions; an extraordinarily unlikely collision fails safely and a retry generates another code. Migration transactions roll back on failure. No RLS, grants, or browser access change.

`GET /p/$code` is public and resolves via the server service-role store. Created/pending links redirect immediately to HTTPS `checkout.adlerrochefort.com` or `checkout.stripe.com`. Missing, paid, expired, incomplete, and failed links show branded messages. **Decision:** failed links are conservatively unavailable, even if Stripe might still allow retry; ask Admin to reconcile before arranging a new payment. Opening a link does not change status or query Stripe. A stale created/pending record may reach Stripe's own completed/expired page until reconciliation updates it. Responses are not cached and send no referrer; no customer details or Checkout URL appear in error HTML.

Optional server-only `PAYMENT_SHORTLINK_ORIGIN=https://pay.adlerrochefort.com` changes the origin used by both create and refresh responses. If unset, the safe application fallback is `https://admin.adlerrochefort.com` (not an untrusted request Host). Configuration must be an HTTPS origin without credentials, path, query, or fragment; a trailing slash is normalized. HTTP is allowed only for localhost outside production.

Future `pay.adlerrochefort.com` setup requires separately configuring DNS, TLS, and hosting this same public route, then setting the variable. This PR does not configure domains, apply production migrations, or deploy. Short links are bearer links: share them only with the intended payer. Tax, surcharge, invoicing, discount, subscription, and adaptive-pricing behavior is unchanged and disabled.

## English Checkout disclosure and transactional notifications

Checkout retains **Insurance Premium** and the dynamic Client / Email / Insurer / Policy description. The English legal disclosure is in `custom_text.submit.message`, near the confirmation button, to keep the product area readable. It identifies Ownizo Unipessoal Lda, NIF **517169029** (matching the repository terms page), ASF registration **425591790/3**, collection on behalf of the insurer, remittance, and `insurance@adlerrochefort.com`. The message is under Stripe's 1,200-character limit. Confirm its hosted layout in Stripe test mode before rollout; no live Session was created for this change.

Apply `migrations/20260921_premium_payment_notifications.sql` after the existing premium migrations and before deploying the notification code. It adds a service-role-only transactional outbox, `premium_payment_notifications`, and an invoker-security trigger on status transitions. It preserves the premium table's constraints, RLS, and grants. Existing payment history is not backfilled into emails.

The application uses the existing **Resend** provider/client with `RESEND_API_KEY` and `EMAIL_FROM` (fallback: `Adler & Rochefort <noreply@adlerrochefort.com>`). Use a verified sender domain. Replies go to `insurance@adlerrochefort.com`; customer and internal deliveries are separate messages, not CC/BCC disclosures.

| Authoritative state | Customer | Internal (`insurance@adlerrochefort.com`) |
| --- | --- | --- |
| Pending | Your payment is pending confirmation | Premium payment pending confirmation |
| Paid | Your payment has been confirmed | Premium payment confirmed |
| Failed | Your payment could not be completed | Premium payment failed |
| Expired | No customer email | Premium payment link expired |

Emails are English and include exact EUR amount, client name/email, insurer, policy, status, configured payment methods clearly labelled **Payment methods offered**, and a delayed-settlement explanation. The integration does not claim that an offered method was actually used. Pending messages include the existing short URL and advise against paying again while settlement is pending. Failed/expired messages ask for review rather than suggesting that an unusable link can be retried. Test-mode notifications are clearly labelled `[TEST]`; they still use the configured mail provider and the entered recipient addresses.

Only verified supported Stripe webhooks dispatch notifications, **after** existing authoritative Stripe reconciliation. Admin polling can commit a transition first; the database trigger atomically queues the notification anyway, and the next webhook drains it. Opening short links never sends mail or changes status. Provider failures do not roll back settlement: the webhook returns 500 so Stripe retries. An error for one audience does not prevent trying the other. No scheduled sender is introduced; monitor failed webhook deliveries and retry them after fixing configuration/provider issues.

### Duplicate safety and recovery

- A unique `(payment_id, status, audience)` constraint creates at most one notification per semantic state and recipient type, independent of Stripe event IDs or repeated transitions.
- Before sending, a conditional database update freezes the full delivery payload and `first_attempt_at`. Concurrent retries use the same persisted payload and stable Resend idempotency key, `premium-notification/<notification UUID>`. Payloads remain stable across sender/origin configuration changes and template deployments.
- `sent_at` and `provider_id` permanently record provider acceptance (not proof of inbox delivery). Completed records are never resent. A provider success followed by a database error is retried with the same key, recovering the original provider ID.
- [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys). Ambiguous attempts at least **23 hours** old are held and return a retryable webhook error; they are not automatically resent after provider deduplication expires. This deliberately prioritizes avoiding duplicate emails over blind eventual retry.
- For a held notification, inspect the server-only outbox row and Resend delivery history using its key. If accepted, record the original provider ID and sent timestamp using a service-role operation. If delivery cannot be determined, do not reset the attempt or change the key. Only after confirming that Resend did not accept the message should an operator explicitly authorize resetting `first_attempt_at` and `delivery_payload` to retry. Never delete successful records or reset sent timestamps.
- Before each delivery the dispatcher reads the current stored payment state. Obsolete pending/failed notifications are marked `skipped_at` instead of being sent after settlement. A newer transition may occur during an in-flight email request; the later confirmed message remains the authoritative update.

Stripe Dashboard successful-payment customer emails/receipts can optionally be enabled as an additional channel. They do not replace these application notifications and can result in a separate Stripe receipt alongside the application confirmation.

All prior exact-EUR, metadata, Customer, short-link, payment-method, signature-verification, and delayed-settlement behavior remains unchanged. No taxes, fees, invoicing, subscriptions, discounts, or currency conversion are introduced. No real emails, production migrations, deployments, or domain changes were performed while implementing this iteration.
