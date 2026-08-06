-- Email that can actually be sent, and addresses that must never be sent to.
--
-- MessageBatch exists because the dispatcher had nowhere to read a body from:
-- Phase 7 queued delivery rows carrying a cost and no content. Suppression is
-- what protects sending reputation — re-mailing a hard bounce damages every
-- message after it, not just the one.
-- AlterTable
ALTER TABLE "EmailDelivery" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "SmsDelivery" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "MessageBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "channel" "Channel" NOT NULL,
    "variationId" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageBatch_organizationId_createdAt_idx" ON "MessageBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Suppression_organizationId_channel_idx" ON "Suppression"("organizationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_organizationId_channel_address_key" ON "Suppression"("organizationId", "channel", "address");

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MessageBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageBatch" ADD CONSTRAINT "MessageBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsDelivery" ADD CONSTRAINT "SmsDelivery_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MessageBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

