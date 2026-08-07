-- Separate "we accepted it" from "a provider took it".
--
-- QUEUED previously doubled as "done", which is how the ledger came to hold
-- charges for messages nothing had ever sent. FAILED gives the dispatcher
-- somewhere to put a message a provider refused, costCents makes committed
-- spend computable from unsent rows, and providerRef on SpendEntry makes a
-- confirmation idempotent: two callbacks for one message collide on the
-- unique index instead of charging twice.
ALTER TYPE "DeliveryStatus" ADD VALUE 'FAILED';

ALTER TABLE "EmailDelivery" ADD COLUMN     "costCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3);

ALTER TABLE "SpendEntry" ADD COLUMN     "providerRef" TEXT;

CREATE UNIQUE INDEX "SpendEntry_organizationId_providerRef_key" ON "SpendEntry"("organizationId", "providerRef");
