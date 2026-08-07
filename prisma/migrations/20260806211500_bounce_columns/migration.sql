-- Delivery news needs somewhere to land: hard bounces suppress, soft ones do not.
-- AlterTable
ALTER TABLE "EmailDelivery" ADD COLUMN     "bounceKind" TEXT,
ADD COLUMN     "bouncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailDelivery_providerRef_idx" ON "EmailDelivery"("providerRef");

