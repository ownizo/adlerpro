# Admin insurance premium Payment Links

`/admin/payment-links` is restricted to administrators. The server function independently enforces the existing admin role middleware before calling Stripe. This collects pass-through premiums for Adler & Rochefort (Ownizo Unipessoal Lda), for subsequent remittance to insurers; it does not automate remittance or create service invoices.

## Configuration

Set server-only environment variables together in each environment:

| Environment | STRIPE_SECRET_KEY | STRIPE_INSURANCE_PREMIUM_PRODUCT_ID |
| --- | --- | --- |
| Development/test | Test credential | prod_VHukk4H9WtEYWh |
| Production | Live credential | prod_VHukIf4wWcTtbT |

Never prefix the secret with `VITE_`. No environment configuration or deployment is performed by this change. The TEST/LIVE badge comes from Stripe's returned Payment Link.

## Behavior

- Amounts accept a decimal point or comma and up to two decimal places, without grouping separators. Conversion uses integer arithmetic; `1248.36` becomes `124836` cents. Amounts must be positive and fit Stripe's eight-digit amount limit. Stripe can reject amounts below its payment-method minimum; amounts are never silently increased.
- A one-time EUR Price references the configured existing product. One fixed quantity, disabled automatic tax, disabled invoice creation, disabled promotion codes, and a one-completed-session restriction are sent explicitly.
- Link and PaymentIntent metadata include purpose, client name/email, insurer, and policy reference. The email is URL-prefilled and remains editable at checkout.
- A UUID identifies each form operation. Distinct Price/Link idempotency keys include the authenticated admin ID. Same-details retries reuse both keys; edits start a new operation. Stripe's idempotency retention is at least 24 hours, not a permanent deduplication store. Reloading the page starts a new operation. After success, creation stays disabled until the admin selects “Create another link”.
- Stripe errors are replaced with a safe message. The form does not add tax, a surcharge, or processing fees. Stripe's merchant processing fee does not change the configured premium.

## Currency limitation requiring review

Stripe currently automatically enables Adaptive Pricing for Payment Links. A EUR Price fixes the underlying premium in EUR, but Payment Links can offer a converted local currency to a payer, including Stripe's conversion fee. The Payment Links API does not expose an Adaptive Pricing disable flag. This means the requested **strictly EUR-only customer checkout is not guaranteed by this integration**. Do not treat this as satisfying that requirement without accepting the limitation. To enforce EUR-only checkout, use hosted Checkout Sessions with Adaptive Pricing disabled instead; that is a change to the requested Payment Links architecture.

References:
- https://docs.stripe.com/payment-links/customize
- https://support.stripe.com/questions/adaptive-pricing
- https://docs.stripe.com/api/payment-link/create

## Validation

Run `npm test`, `npm run build`, and `npx tsc --noEmit`. Focused tests validate decimal conversion, hostile inputs, Stripe request settings, retry keys, metadata propagation, and error sanitization with a stub Stripe client. No Stripe objects or real payments are created by the tests. A real test-mode checkout still needs verification with configured credentials, including single-completion behavior.
