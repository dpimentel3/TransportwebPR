import Stripe from 'stripe'
import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  const secretKey = Netlify.env.get('STRIPE_SECRET_KEY')
  const publishableKey = Netlify.env.get('STRIPE_PUBLISHABLE_KEY')

  if (!secretKey || !publishableKey) {
    return Response.json(
      { error: 'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY.' },
      { status: 500 },
    )
  }

  // The dahlia API version and the payment-form preview flag are both required by
  // the embedded custom payment form.
  const stripe = new Stripe(secretKey, {
    apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1' as Stripe.StripeConfig['apiVersion'],
  })

  // TODO: set to "subscription" if the guide ever becomes a recurring product.
  const mode: Stripe.Checkout.SessionCreateParams.Mode = 'payment'

  // Where Stripe sends the buyer back after a redirect-based payment method.
  const origin = new URL(req.url).origin

  const sessionParams = {
    ui_mode: 'form',
    mode,
    // TODO: replace with the real Stripe Price ID for The Culebra Insider Guide.
    // See STRIPE_INTEGRATION_TODO.md.
    line_items: [{ price: 'price_...', quantity: 1 }],
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: true },
    submit_type: 'auto',
    name_collection: { individual: { enabled: true, optional: true } },
    payment_intent_data: { setup_future_usage: 'on_session' },
    integration_identifier: 'custom_embedded_web_0001',
    return_url: `${origin}/itineraries-guides.html?checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
  } as Stripe.Checkout.SessionCreateParams

  // payment_method_collection only applies to subscriptions.
  if (mode === 'subscription') {
    sessionParams.payment_method_collection = 'always'
  }

  const session = await stripe.checkout.sessions.create(sessionParams)

  // The browser needs both values to boot Stripe.js, and returning the publishable
  // key here keeps every Stripe key out of the repository.
  return Response.json({
    client_secret: session.client_secret,
    publishable_key: publishableKey,
  })
}

export const config: Config = {
  path: '/api/create-checkout-session',
  method: 'POST',
}
