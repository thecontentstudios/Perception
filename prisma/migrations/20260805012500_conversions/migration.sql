-- Conversions become attributable, and survivable when they aren't.
--
-- `campaignId` drops its NOT NULL deliberately: an unattributed quote request
-- is still a real quote request, and discarding it would make the totals
-- quietly wrong. The table is empty, so adding the required organizationId
-- needs no back-fill.

ALTER TABLE "Conversion" ALTER COLUMN "campaignId" DROP NOT NULL;
ALTER TABLE "Conversion" ADD COLUMN "organizationId" TEXT NOT NULL;
ALTER TABLE "Conversion" ADD COLUMN "variationId" TEXT;
ALTER TABLE "Conversion" ADD COLUMN "clickId" TEXT;
ALTER TABLE "Conversion" ADD COLUMN "externalId" TEXT;

ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_variationId_fkey"
  FOREIGN KEY ("variationId") REFERENCES "ChannelVariation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_clickId_fkey"
  FOREIGN KEY ("clickId") REFERENCES "LinkClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Conversion_organizationId_externalId_key" ON "Conversion"("organizationId", "externalId");
CREATE INDEX "Conversion_variationId_idx" ON "Conversion"("variationId");
