import Stripe from 'stripe'
import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  const secretKey = Netlify.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Netlify.env.get('STRIPE_WEBHOOK_SECRET')
  const signature = req.headers.get('stripe-signature')

  if (!secretKey || !webhookSecret) {
    return Response.json({ error: 'Stripe webhook is not configured.' }, { status: 500 })
  }
  if (!signature) {
    return Response.json({ error: 'Missing stripe-signature header.' }, { status: 400 })
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1' as Stripe.StripeConfig['apiVersion'],
  })

  // Signature verification needs the unparsed request body.
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret)
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error)
    return Response.json({ error: 'Invalid signature.' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    // TODO: fulfil the order here — email the guide link to
    // session.customer_details?.email. See STRIPE_INTEGRATION_TODO.md.
    console.log('Guide purchase completed for session', session.id)
  } else {
    console.log('Unhandled Stripe event type:', event.type)
  }

  return Response.json({ received: true })
}

export const config: Config = {
  path: '/api/stripe-webhook',
  method: 'POST',
}
