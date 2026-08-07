-- DropForeignKey
ALTER TABLE "Metric" DROP CONSTRAINT "Metric_variationId_fkey";

-- AlterTable
ALTER TABLE "Metric" ADD COLUMN     "postMissing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'platform',
ALTER COLUMN "impressions" DROP NOT NULL,
ALTER COLUMN "impressions" DROP DEFAULT,
ALTER COLUMN "clicks" DROP NOT NULL,
ALTER COLUMN "clicks" DROP DEFAULT,
ALTER COLUMN "engagements" DROP NOT NULL,
ALTER COLUMN "engagements" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "Metric_variationId_source_capturedAt_key" ON "Metric"("variationId", "source", "capturedAt");

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "ChannelVariation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

