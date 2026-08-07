-- A public per-tenant key for the tracking snippet.
--
-- Added nullable, back-filled, then made NOT NULL and unique. Uses
-- gen_random_uuid(), which is built into Postgres 13+, rather than pgcrypto's
-- gen_random_bytes() — one fewer extension a deployment has to have enabled.
--
-- It is deliberately *not* a secret: it ships in the page source of every
-- customer site, so it identifies a tenant and authorizes nothing.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "ingestKey" TEXT;
UPDATE "Organization" SET "ingestKey" = 'pk_' || replace(gen_random_uuid()::text, '-', '') WHERE "ingestKey" IS NULL;
ALTER TABLE "Organization" ALTER COLUMN "ingestKey" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_ingestKey_key" ON "Organization"("ingestKey");
