import Stripe from 'stripe'
import type { Config } from '@netlify/functions'

// A Price ID that was never replaced looks like the placeholder from the setup guide.
// Catching it here turns an opaque Stripe "no such price" error into a clear message.
const isPlaceholder = (priceId: string) => !/^price_[A-Za-z0-9]{6,}$/.test(priceId)

export default async (req: Request) => {
  const secretKey = Netlify.env.get('STRIPE_SECRET_KEY')
  const publishableKey = Netlify.env.get('STRIPE_PUBLISHABLE_KEY')
  const priceId = Netlify.env.get('STRIPE_PRICE_ID')

  const missing = [
    !secretKey && 'STRIPE_SECRET_KEY',
    !publishableKey && 'STRIPE_PUBLISHABLE_KEY',
    !priceId && 'STRIPE_PRICE_ID',
  ].filter(Boolean)

  if (missing.length) {
    const error = `Stripe is not configured. Missing environment variable(s): ${missing.join(', ')}.`
    console.error(error, 'See STRIPE_INTEGRATION_TODO.md.')
    return Response.json({ error }, { status: 500 })
  }

  if (isPlaceholder(priceId!)) {
    const error =
      'STRIPE_PRICE_ID is not a valid Stripe Price ID. Set it to the real price for The Culebra Insider Guide.'
    console.error(error)
    return Response.json({ error }, { status: 500 })
  }

  // The dahlia API version and the payment-form preview flag are both required by
  // the embedded custom payment form.
  const stripe = new Stripe(secretKey!, {
    apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1' as Stripe.StripeConfig['apiVersion'],
  })

  // TODO: set to "subscription" if the guide ever becomes a recurring product.
  const mode: Stripe.Checkout.SessionCreateParams.Mode = 'payment'

  // Where Stripe sends the buyer back after a redirect-based payment method.
  const origin = new URL(req.url).origin

  const sessionParams = {
    ui_mode: 'form',
    mode,
    line_items: [{ price: priceId!, quantity: 1 }],
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

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.create(sessionParams)
  } catch (error) {
    // Without this the browser only ever sees a bare 500, which is why a
    // misconfigured price or an inactive Stripe Tax account looked like
    // "the form just doesn't load".
    const message = error instanceof Error ? error.message : 'Unknown error creating Checkout Session.'
    console.error('Stripe Checkout Session creation failed:', message)
    return Response.json({ error: message }, { status: 502 })
  }

  if (!session.client_secret) {
    const error = 'Stripe returned a Checkout Session without a client secret.'
    console.error(error, 'session:', session.id)
    return Response.json({ error }, { status: 502 })
  }

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
