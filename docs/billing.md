# Supporter billing

Free keeps the studio, publishing and public rooms. Supporter is a monthly subscription that funds Untergrund and adds a badge to the subscriber's public artist page. Start with one `Untergrund Supporter` product and a fixed USD recurring price ($12/month proposed); the Plans page displays the configured Stripe Price. A SoundCloud-linked creator account is required so members can recover billing access on a different device.

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

4. Open `/pricing`, sign in, and pay with a [Stripe test card](https://docs.stripe.com/testing). Verify the paid state, webhook delivery and badge at `/a/<handle>`. Test a canceled checkout, a returning subscriber, and portal cancellation. In sandbox, cancel immediately in the Stripe Dashboard to confirm the badge disappears. Checkout and portal URLs are generated server-side; callbacks alone do not grant membership.
5. Before going live, finish Stripe account activation, confirm the actual price, tax treatment and cancellation terms, and confirm production account authentication is ready. Repeat setup with **live** resources under Vercel **Production** at `https://www.untergrund.sh`, set `UNTERGRUND_STRIPE_MODE=live`, then redeploy. Nothing charges while configuration is absent. Do not copy preview credentials into production. Verify app and webhook readiness before directing customers to checkout.

Stripe owns subscription state; signed events refresh the cached artist badge from the current subscription, so retries and late delivery do not restore a canceled badge. If a badge is out of date, check destination deliveries and resend the latest subscription event. To stop new sales in an incident, archive the Price in Stripe and expire any open Checkout Sessions; keep the webhook destination and portal configuration in place for existing subscribers.
