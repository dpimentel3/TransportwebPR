# Stripe Integration — Setup Guide

This is the single source of truth for finishing the Stripe checkout behind the
**Get Your Guide** button on [The Culebra Insider Guide](itineraries-guides.html) card.
Work through **Values to Replace** and **Setup** below; the rest is reference.

The card now uses a **Stripe Buy Button** (`<stripe-buy-button>`), so the button itself
and the checkout page it opens are both configured in the Stripe Dashboard rather than in
this repository. The button's copy, price and success URL live in the Dashboard under that
buy button; there is no client-side payment code left on the page.

Delivery still runs through `/api/stripe-webhook`, which listens for
`checkout.session.completed` — the buy button's hosted Checkout emits the same event.

The **embedded custom payment form** described in the reference sections below
(`ui_mode: 'form'`, the checkout modal, `netlify/functions/create-checkout-session.mts`)
is the previous implementation. The modal and its client-side wiring have been removed
from `itineraries-guides.html`; the function is still in the repository but nothing calls
it.

---

## Values to Replace

The following values are not set yet and must be configured before going live. All of
them are environment variables — see Setup step 1 for where to put them.

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| `STRIPE_PRICE_ID` | unset | Your actual Stripe Price ID for The Culebra Insider Guide, from the Dashboard (<https://dashboard.stripe.com/prices>) or API. Starts with `price_`. Set as an environment variable (see Setup step 1) — it is no longer hardcoded in the function. |
| `mode` | `payment` | Keep `payment` for a one-time charge, or set `subscription` for recurring billing. See the note under Configured Parameters before switching. |
| `GUIDE_DOWNLOAD_URL` | unset | The link the buyer receives for the guide. The webhook will not deliver without it. |
| `GUIDE_FROM_EMAIL` | unset | The address the guide email is sent from. |

---

## Configured Parameters

These parameters were configured in Checkout Studio and are already set correctly.

**Files containing these parameters:**
- [netlify/functions/create-checkout-session.mts](netlify/functions/create-checkout-session.mts)

| Parameter | Value |
|-----------|-------|
| `ui_mode` | `form` |
| `billing_address_collection` | `auto` |
| `phone_number_collection` | `{ enabled: false }` |
| `automatic_tax` | `{ enabled: true }` |
| `submit_type` | `auto` |
| `name_collection` | `{ individual: { enabled: true, optional: true } }` |
| `payment_intent_data` | `{ setup_future_usage: 'on_session' }` |
| `integration_identifier` | `custom_embedded_web_0001` |
| `payment_method_collection` | `always` — applied only when `mode` is `subscription` |
| Stripe API version | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |

Also set, so the flow works end to end:

| Parameter | Value |
|-----------|-------|
| `return_url` | `<site origin>/itineraries-guides.html?checkout=complete&session_id={CHECKOUT_SESSION_ID}` |

**Files containing the client-side configuration:**
- [itineraries-guides.html](itineraries-guides.html)

| Parameter | Value |
|-----------|-------|
| Stripe.js source | `https://js.stripe.com/dahlia/stripe.js`, loaded in `<head>` — never bundled or self-hosted (PCI requirement) |
| `Stripe(...)` betas | `['custom_checkout_payment_form_1']` |
| `createForm` layout | `expanded` |
| Appearance | `theme: stripe`, `labels: auto`, `inputs: spaced`, `borderRadius: 4px`, `colorPrimary: #0570de`, `colorText: #30313d`, `fontSizeBase: 16px`, `spacingUnit: 4px` |

Three things to know about this parameter set:

- `payment_method_collection: 'always'` only applies to subscriptions, so it sits behind
  an `if (mode === 'subscription')` check rather than being set unconditionally.
- `payment_intent_data` is valid in `payment` mode only. If you switch `mode` to
  `subscription`, move `setup_future_usage` into `subscription_data` instead.
- `setup_future_usage: 'on_session'` saves the buyer's card for reuse. If Stripe returns
  an error about needing a customer, add `customer_creation: 'always'` to the same call.

---

## Setup

### 1. Environment variables

Set these on the site, not in the repository — Netlify Dashboard → **Site configuration
→ Environment variables**, or `netlify env:set NAME value`. For local development put
them in a `.env` file at the repo root; `netlify dev` loads it automatically and `.env`
is not committed.

The names below are exactly what the code reads. This project has no bundler, so there
are no browser-prefixed (`VITE_`) variables — the publishable key is served to the page
by the function instead of being compiled in.

| Variable | Where it is used | Notes |
|----------|------------------|-------|
| `STRIPE_SECRET_KEY` | Server only | Starts with `sk_test_` / `sk_live_`. Never expose this to the browser. |
| `STRIPE_PUBLISHABLE_KEY` | Read on the server, returned to the browser | Starts with `pk_test_` / `pk_live_`. Safe to be public, but serving it from the function keeps it out of the repo. |
| `STRIPE_WEBHOOK_SECRET` | Server only | Starts with `whsec_`. From the webhook endpoint you create in step 5. |
| `STRIPE_PRICE_ID` | Server only | Starts with `price_`. The price for The Culebra Insider Guide. Not a secret, but kept in configuration so the repository has no environment-specific IDs — test and live mode have different price IDs. |
| `GUIDE_DOWNLOAD_URL` | Server only | The link emailed to the buyer after payment. |
| `GUIDE_FROM_EMAIL` | Server only | The sender address for the guide email. |

**The payment form will not load until `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and
`STRIPE_PRICE_ID` are all set.** `/api/create-checkout-session` returns a 500 naming the
variables it could not find, and the browser console shows that same message.

Guide delivery additionally needs the Netlify Emails provider configured — see
[Guide delivery](#guide-delivery) below.

Get the first two from the [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys).
There is no `DOMAIN` variable to set: `return_url` is built from the incoming request's
origin, so it works on localhost, deploy previews and production without configuration.

### 2. Turn on Stripe Tax — required

`automatic_tax` is enabled, so **Checkout Session creation will fail until Stripe Tax is
active**. Two one-time steps:

1. Activate Stripe Tax and register your origin address at
   [Tax settings](https://dashboard.stripe.com/settings/tax).
2. Give the guide's product a tax code (a digital-product or e-book code is the right
   category for a downloadable guide) in the
   [Product catalog](https://dashboard.stripe.com/products).

If you would rather not deal with tax collection yet, set `automatic_tax` to
`{ enabled: false }` in the function — but note that diverges from your Checkout Studio
configuration.

### 3. API keys and test mode

Use test keys (`sk_test_…` / `pk_test_…`) while building. Test and live mode have
entirely separate keys, products and prices, so going live means swapping both keys
**and** recreating the product in live mode — the `price_` ID will be different.

### 4. Dependencies

Already declared in [package.json](package.json) and installed by Netlify at deploy
time. Locally:

```bash
npm install
```

- `stripe` — server SDK, currently `^22.6.1`. Because this is at or above 21.0.0, the
  correct `ui_mode` is `form`. If you ever downgrade below 21.0.0, change it to `custom`.
- `@netlify/functions` — TypeScript types for the function handlers.
- `@netlify/database`, `drizzle-orm`, `drizzle-kit` — used to record purchases so the
  guide is never emailed twice. Drizzle is pinned to its `beta` line, which is the only
  one carrying the Netlify Database adapter.

### 5. Webhook endpoint

Required — this is what delivers the guide after payment.

- **Production:** [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) →
  add endpoint `https://www.dptransportpr.com/api/stripe-webhook`, subscribe to
  `checkout.session.completed`, then copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
- **Local:** `stripe listen --forward-to localhost:8888/api/stripe-webhook` and use the
  `whsec_…` it prints.

---

## Project Structure

New files:

```
.
├── netlify/
│   ├── functions/
│   │   ├── create-checkout-session.mts   POST /api/create-checkout-session
│   │   └── stripe-webhook.mts            POST /api/stripe-webhook
│   └── database/migrations/              applied by Netlify at deploy time
├── db/
│   ├── schema.ts                         guide_purchases table
│   └── index.ts                          Drizzle client
├── emails/
│   └── guide-delivery/index.html         the email the buyer receives
├── drizzle.config.ts                     migration output settings
├── package.json                          stripe, @netlify/database, drizzle
└── STRIPE_INTEGRATION_TODO.md            this file
```

Modified:

```
├── itineraries-guides.html   buy-button.js in <head>, <stripe-buy-button> on the card
└── .gitignore                added node_modules
```

---

## How It Works

1. A visitor loads the Culebra card. `js.stripe.com/v3/buy-button.js`, loaded in `<head>`,
   renders the `<stripe-buy-button>` element in place of the old CTA button.
2. Clicking it opens the Stripe-hosted Checkout page configured for that buy button.
3. Stripe posts `checkout.session.completed` to `/api/stripe-webhook`. That function
   records the purchase, then emails the buyer their guide link. See
   [Guide delivery](#guide-delivery).

The webhook endpoint and `STRIPE_WEBHOOK_SECRET` must belong to the same Stripe account
and mode (live vs. test) as the buy button, or delivery never fires.

The steps below describe the previous embedded-form flow and no longer run:

1. A visitor clicks **Get Your Guide** on the Culebra card, and the checkout modal opens.
2. The browser `POST`s to `/api/create-checkout-session`.
3. `create-checkout-session.mts` creates a Checkout Session with `ui_mode: 'form'` and
   returns JSON — `{ client_secret, publishable_key }`. It returns JSON rather than a
   redirect, because the payment form is embedded in the page.
4. The browser boots `Stripe(publishable_key, { betas: ['custom_checkout_payment_form_1'] })`,
   calls `stripe.initCheckoutFormSdk({ clientSecret, appearance })`, then
   `checkout.createForm({ layout: 'expanded' })` and mounts it into `#checkout-form`.
5. `checkout.loadActions()` resolves, and the form's `confirm` event calls
   `actions.confirm({ formConfirmEvent: event })` to take the payment in place.
6. Payment methods that need a redirect (bank redirects, wallets) send the buyer to
   `return_url`. The page reads `?checkout=complete` and shows a confirmation.
7. Stripe posts `checkout.session.completed` to `/api/stripe-webhook`. That function
   records the purchase, then emails the buyer their guide link. See
   [Guide delivery](#guide-delivery).

The session is created once per modal open and reused, so reopening the modal does not
create duplicate Checkout Sessions. A failed load resets so the next click retries.

---

## Testing

Run the site with the functions attached:

```bash
netlify dev
```

Then open `http://localhost:8888/itineraries-guides.html` and click **Get Your Guide**.

With test-mode keys, use any future expiry date, any 3-digit CVC and any postal code:

| Card number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | Visa — payment succeeds |
| `5555 5555 5555 4444` | Mastercard — payment succeeds |
| `3782 822463 10005` | Amex — payment succeeds |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |
| `4000 0000 0000 9995` | Declined — insufficient funds |
| `4000 0000 0000 0002` | Declined — generic card decline |
| `4000 0000 0000 0069` | Declined — expired card |
| `4100 0000 0000 0019` | Blocked as fraudulent |

Full list: <https://docs.stripe.com/testing>

Real cards are never charged in test mode, and test payments never appear in live mode.
Check results under [Payments](https://dashboard.stripe.com/test/payments) with the
dashboard's test-mode toggle on. Because `automatic_tax` is on, confirm the tax line
appears in the form for a couple of different billing addresses.

---

## Next Steps

### Updating the product

- Change the price or name in the
  [Product catalog](https://dashboard.stripe.com/products). Existing prices cannot be
  edited — create a new price and update the `STRIPE_PRICE_ID` environment variable.
- Adding a second guide: give each card its own `data-price-id`, pass it to the function,
  and validate it server-side against a list of allowed price IDs. Never accept an
  arbitrary price ID from the browser.

### Guide delivery

Delivery is implemented. When `checkout.session.completed` arrives, the webhook records
the purchase, then emails the buyer the link in `GUIDE_DOWNLOAD_URL` using the
[Netlify Emails](https://docs.netlify.com/extend/install-and-use/setup-guides/email-integration/)
template in `emails/guide-delivery/index.html`.

The email is sent from the webhook rather than the browser on purpose: the buyer may
close the tab after paying, and only the webhook is guaranteed to fire.

**To turn it on, set the email provider variables** — the integration is enabled on this
site but has no provider, so sends currently fail:

| Variable | Notes |
|----------|-------|
| `NETLIFY_EMAILS_PROVIDER` | `mailgun`, `sendgrid` or `postmark`. |
| `NETLIFY_EMAILS_PROVIDER_API_KEY` | API key from that provider. |
| `NETLIFY_EMAILS_MAILGUN_DOMAIN` | Mailgun only. |
| `NETLIFY_EMAILS_MAILGUN_HOST_REGION` | Mailgun only — `non-eu` or `eu`. |

Scope these to both **Builds** and **Functions**. `NETLIFY_EMAILS_SECRET` and
`NETLIFY_EMAILS_DIRECTORY` are already set.

Editing the email: it is plain HTML with handlebars placeholders, and receives `name`
(may be empty, since name collection is optional), `guideUrl` and `orderReference`.
Preview it locally with `netlify dev` at
`http://localhost:8888/.netlify/functions/emails`.

**Delivery is sent once per purchase.** Stripe can deliver the same webhook event more
than once, so each purchase is recorded against its Checkout Session ID and flagged when
the email actually goes out. A repeated event for an already-delivered purchase is
ignored; a genuine send failure returns an error so Stripe retries and the buyer still
gets the guide.

If you would rather gate the link than email it, store the session ID and issue a
one-time access URL — that is the only option that actually stops link sharing.

### Order tracking

- Every purchase appears under [Payments](https://dashboard.stripe.com/payments) with the
  buyer's email and billing address. Because `setup_future_usage` is set, repeat buyers
  are also saved as Customers with a reusable payment method.
- Purchases are also recorded in this project's Netlify Database, in the
  `guide_purchases` table — session ID, email, name, amount, currency, and whether the
  guide email was delivered. The schema lives in [db/schema.ts](db/schema.ts) and the
  migration in `netlify/database/migrations/`; Netlify applies it at deploy time.
- A row with `guide_delivered` still `false` is a purchase that was paid for but not
  emailed — worth checking if a buyer says they received nothing.
- Webhooks can be delivered more than once, so make fulfillment idempotent: skip a
  session ID you have already handled.

### Optional: consent collection

`consent_collection` is not part of this configuration, so `session.consent` is always
null and the webhook does not check it. If you want terms-of-service acceptance or
marketing opt-in, add `consent_collection` to the Checkout Session and then read
`session.consent.terms_of_service` / `session.consent.promotions` in the webhook.

---

## Resources

- Stripe support: <https://support.stripe.com>
- Stripe MCP server (Stripe docs and tools from your editor): <https://docs.stripe.com/mcp>
