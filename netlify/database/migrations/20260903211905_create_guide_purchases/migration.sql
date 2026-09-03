CREATE TABLE "guide_purchases" (
	"id" serial PRIMARY KEY,
	"stripe_session_id" text NOT NULL UNIQUE,
	"email" text,
	"customer_name" text,
	"amount_total" integer,
	"currency" text,
	"guide_delivered" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
