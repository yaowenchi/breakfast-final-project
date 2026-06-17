ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'customer' NOT NULL;
--> statement-breakpoint
UPDATE "users"
SET "role" = 'staff'
WHERE lower("email") = lower('demo@example.com')
  AND "role" = 'customer';
