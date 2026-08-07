-- AlterTable
ALTER TABLE "SpendEntry" ADD COLUMN     "flightId" TEXT;

-- CreateTable
CREATE TABLE "AdFlight" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT,
    "campaignId" TEXT,
    "channel" "Channel" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "objective" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "headline" TEXT,
    "body" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "dailyCents" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "estImpressionsLow" INTEGER NOT NULL,
    "estImpressionsHigh" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handedOffAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settledCents" INTEGER,

    CONSTRAINT "AdFlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdFlight_organizationId_status_idx" ON "AdFlight"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AdFlight_organizationId_createdAt_idx" ON "AdFlight"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SpendEntry" ADD CONSTRAINT "SpendEntry_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "AdFlight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdFlight" ADD CONSTRAINT "AdFlight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdFlight" ADD CONSTRAINT "AdFlight_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

