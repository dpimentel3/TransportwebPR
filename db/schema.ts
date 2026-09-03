import { pgTable, serial, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'

// One row per completed Checkout Session. Stripe can deliver the same webhook event
// more than once, so `stripeSessionId` is unique and `guideDelivered` records whether
// the guide email actually went out — together they stop a buyer being emailed twice
// while still allowing a retry after a genuine send failure.
export const guidePurchases = pgTable('guide_purchases', {
  id: serial().primaryKey(),
  stripeSessionId: text('stripe_session_id').notNull().unique(),
  email: text(),
  customerName: text('customer_name'),
  amountTotal: integer('amount_total'),
  currency: text(),
  guideDelivered: boolean('guide_delivered').notNull().default(false),
  deliveredAt: timestamp('delivered_at'),
  createdAt: timestamp('created_at').defaultNow(),
})
