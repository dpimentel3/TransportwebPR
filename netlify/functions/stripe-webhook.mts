import Stripe from 'stripe'
import type { Config } from '@netlify/functions'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { guidePurchases } from '../../db/schema.js'

// Sends the guide email through the Netlify Emails integration, using the template in
// emails/guide-delivery. Throws on failure so the caller can ask Stripe to retry.
const sendGuideEmail = async (opts: {
  siteUrl: string
  emailsSecret: string
  from: string
  to: string
  name: string | null
  guideUrl: string
  orderReference: string
}) => {
  const response = await fetch(`${opts.siteUrl}/.netlify/functions/emails/guide-delivery`, {
    method: 'POST',
    headers: {
      'netlify-emails-secret': opts.emailsSecret,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: 'Your Culebra Insider Guide',
      parameters: {
        name: opts.name ?? '',
        guideUrl: opts.guideUrl,
        orderReference: opts.orderReference,
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Netlify Emails responded ${response.status}. ${detail}`.trim())
  }
}

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

  if (event.type !== 'checkout.session.completed') {
    console.log('Unhandled Stripe event type:', event.type)
    return Response.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const email = session.customer_details?.email ?? null

  // Record the purchase before anything that can fail, so a payment is never lost
  // just because delivery is misconfigured. The unique session ID makes a repeated
  // webhook delivery a no-op rather than a second row.
  let purchase: typeof guidePurchases.$inferSelect | undefined
  try {
    await db
      .insert(guidePurchases)
      .values({
        stripeSessionId: session.id,
        email,
        customerName: session.customer_details?.name ?? null,
        amountTotal: session.amount_total,
        currency: session.currency,
      })
      .onConflictDoNothing({ target: guidePurchases.stripeSessionId })

    ;[purchase] = await db
      .select()
      .from(guidePurchases)
      .where(eq(guidePurchases.stripeSessionId, session.id))
  } catch (error) {
    // Deliberately do not send the email here: without the record we cannot tell a
    // first delivery from a repeat, and emailing the guide twice is worse than a
    // delay. Stripe retries, so the order is not lost.
    const message = error instanceof Error ? error.message : 'Unknown database error.'
    console.error('Could not record the guide purchase for session', session.id, '-', message)
    return Response.json({ error: 'Could not record the purchase.' }, { status: 500 })
  }

  // The guard is on delivery, not on the row existing, so a retry after a failed
  // send still goes out while an already-delivered guide is never sent twice.
  if (purchase?.guideDelivered) {
    console.log('Guide already delivered for session', session.id, '- skipping.')
    return Response.json({ received: true, alreadyDelivered: true })
  }

  if (!email) {
    // Checkout always collects an email, so this should not happen. Retrying cannot
    // help, so accept the event and leave the row flagged for manual follow-up.
    console.error('No customer email on session', session.id, '- cannot deliver the guide.')
    return Response.json({ received: true, delivered: false })
  }

  const emailsSecret = Netlify.env.get('NETLIFY_EMAILS_SECRET')
  const guideUrl = Netlify.env.get('GUIDE_DOWNLOAD_URL')
  const from = Netlify.env.get('GUIDE_FROM_EMAIL')
  const siteUrl = Netlify.env.get('URL') ?? new URL(req.url).origin

  const missing = [
    !emailsSecret && 'NETLIFY_EMAILS_SECRET',
    !guideUrl && 'GUIDE_DOWNLOAD_URL',
    !from && 'GUIDE_FROM_EMAIL',
  ].filter(Boolean)

  if (missing.length) {
    // Returning an error makes Stripe retry, so the guide is still delivered once the
    // configuration is in place. The purchase is already recorded either way.
    console.error(
      `Cannot deliver the guide for session ${session.id}. Missing environment variable(s): ${missing.join(', ')}.`,
    )
    return Response.json({ error: `Delivery not configured: ${missing.join(', ')}.` }, { status: 500 })
  }

  try {
    await sendGuideEmail({
      siteUrl,
      emailsSecret: emailsSecret!,
      from: from!,
      to: email,
      name: session.customer_details?.name ?? null,
      guideUrl: guideUrl!,
      orderReference: session.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error sending the guide email.'
    // Keep the provider's response in the logs rather than echoing it back.
    console.error('Guide delivery failed for session', session.id, '-', message)
    // Ask Stripe to retry rather than swallowing a paid-but-undelivered order.
    return Response.json({ error: 'Could not send the guide email.' }, { status: 500 })
  }

  try {
    await db
      .update(guidePurchases)
      .set({ guideDelivered: true, deliveredAt: new Date() })
      .where(eq(guidePurchases.stripeSessionId, session.id))
  } catch (error) {
    // The buyer already has the email, so report success even though the flag did not
    // stick. Returning an error would make Stripe retry and send the guide a second
    // time, which is the one outcome the flag exists to prevent.
    const message = error instanceof Error ? error.message : 'Unknown database error.'
    console.error(
      'Guide was emailed for session', session.id,
      'but marking it delivered failed -', message,
      '- the row still reads undelivered.',
    )
    return Response.json({ received: true, delivered: true, recorded: false })
  }

  console.log('Guide delivered for session', session.id)
  return Response.json({ received: true, delivered: true })
}

export const config: Config = {
  path: '/api/stripe-webhook',
  method: 'POST',
}
