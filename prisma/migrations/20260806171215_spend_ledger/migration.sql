-- CreateTable
CREATE TABLE "SpendEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "channel" "Channel" NOT NULL,
    "kind" TEXT NOT NULL,
    "certainty" TEXT NOT NULL DEFAULT 'exact',
    "cents" INTEGER NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "campaignId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "channel" "Channel",
    "month" TEXT NOT NULL,
    "capCents" INTEGER NOT NULL,
    "hardStop" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsDelivery" (
    "id" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "segments" INTEGER NOT NULL,
    "encoding" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "providerRef" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failReason" TEXT,

    CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpendEntry_organizationId_occurredAt_idx" ON "SpendEntry"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "SpendEntry_organizationId_channel_occurredAt_idx" ON "SpendEntry"("organizationId", "channel", "occurredAt");

-- CreateIndex
CREATE INDEX "Budget_organizationId_month_idx" ON "Budget"("organizationId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_organizationId_brandId_channel_month_key" ON "Budget"("organizationId", "brandId", "channel", "month");

-- CreateIndex
CREATE INDEX "SmsDelivery_variationId_status_idx" ON "SmsDelivery"("variationId", "status");

-- CreateIndex
CREATE INDEX "SmsDelivery_contactId_idx" ON "SmsDelivery"("contactId");

-- AddForeignKey
ALTER TABLE "SpendEntry" ADD CONSTRAINT "SpendEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendEntry" ADD CONSTRAINT "SpendEntry_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendEntry" ADD CONSTRAINT "SpendEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsDelivery" ADD CONSTRAINT "SmsDelivery_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
