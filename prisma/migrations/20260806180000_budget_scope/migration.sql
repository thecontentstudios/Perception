-- Replace the nullable compound unique with a non-null scope key.
--
-- Postgres treats NULLs as distinct, so the old index let two workspace-wide
-- caps (brandId NULL, channel NULL) coexist — and the second one is the cap
-- nobody enforces. Prisma also refuses nullable columns in an upsert's where.
DROP INDEX "Budget_organizationId_brandId_channel_month_key";

ALTER TABLE "Budget" ADD COLUMN "scope" TEXT NOT NULL;

CREATE UNIQUE INDEX "Budget_organizationId_scope_month_key" ON "Budget"("organizationId", "scope", "month");
