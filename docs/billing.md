# Studio Pro billing

Free keeps the studio, single-song generation, exports, publishing, and public rooms. Studio Pro adds three alternative editable arrangements from one brief without restricting any Free features. Members get 60 successful draft sets per UTC calendar month. Start with one `Untergrund Studio Pro` product and a fixed $19 USD monthly Price; other amounts are rejected. A SoundCloud-linked creator account keeps billing and draft access tied to the same account across devices.

## Before enabling checkout

1. In the **Untergrund** Stripe sandbox, create a [product and monthly USD price](https://docs.stripe.com/products-prices/manage-prices). Configure the [customer portal](https://docs.stripe.com/customer-management/configure-portal) for invoice and payment details and cancellation at period end; leave plan changes off.
2. Create a [webhook destination](https://docs.stripe.com/webhooks) at `<billing origin>/api/billing/webhook`. Subscribe to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, and `customer.subscription.resumed`. For local development, the Stripe CLI can forward signed events to that route instead.
3. Set the following on the local server or in Vercel's **Preview** environment. Keep secret and signing keys server-side and use Stripe test-mode resources throughout. The origin must be the exact site origin, without a trailing slash; localhost HTTP is supported for sandbox testing.

| Variable | Value |
| --- | --- |
| `UNTERGRUND_STRIPE_MODE` | `test` in sandbox |
| `UNTERGRUND_STRIPE_SECRET_KEY` | Untergrund Stripe test key (Prices read, Customers/Checkout/Portal write, Subscriptions read) |
| `UNTERGRUND_STRIPE_WEBHOOK_SECRET` | Signing secret for this destination or Stripe CLI listener |
| `UNTERGRUND_STRIPE_PRICE_ID` | Recurring USD Price ID |
| `UNTERGRUND_STRIPE_PORTAL_CONFIGURATION` | Portal configuration ID |
| `UNTERGRUND_BILLING_ORIGIN` | Exact origin used for checkout, portal and returns, e.g. `http://localhost:8020` |
| `OPENROUTER_API_KEY` or `GEMINI_API_KEY` | Existing song generation provider; checkout is paused without it |
| `UNTERGRUND_LIVE_CHECKOUT` | Leave unset in sandbox and before launch; set to `1` only after explicit go-live approval |

4. Open `/pricing`, sign in, and pay with a [Stripe test card](https://docs.stripe.com/testing). Verify the paid state, webhook delivery, and badge at `/a/<handle>`. In the studio, enter a brief, choose **3 drafts · Pro**, and open a draft. Test a canceled checkout, a returning subscriber, and portal cancellation. In sandbox, cancel immediately in Stripe and confirm the badge and access disappear. Checkout callbacks alone do not grant membership.
5. Before going live, finish Stripe account activation and confirm pricing, tax treatment, cancellation terms, and production authentication. Repeat setup with **live** resources under Vercel **Production** at `https://www.untergrund.sh`, set `UNTERGRUND_STRIPE_MODE=live`, then redeploy. After checking app and webhook readiness and obtaining approval, set `UNTERGRUND_LIVE_CHECKOUT=1` and redeploy to accept payments. Do not copy preview credentials into production.

Stripe owns subscription state. Draft generation checks the current subscription for the configured Price on every request and does not count failed model calls against the monthly allowance. Signed events refresh the cached artist badge from the current subscription, so retries and late delivery do not restore a canceled badge. To stop new sales in an incident, unset `UNTERGRUND_LIVE_CHECKOUT` and redeploy, archive the Price in Stripe, and expire any open Checkout Sessions. Keep the webhook destination and portal configuration in place for existing subscribers.
