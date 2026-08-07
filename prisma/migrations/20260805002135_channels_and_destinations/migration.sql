-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Channel" ADD VALUE 'X';
ALTER TYPE "Channel" ADD VALUE 'THREADS';
ALTER TYPE "Channel" ADD VALUE 'BLUESKY';
ALTER TYPE "Channel" ADD VALUE 'MASTODON';
ALTER TYPE "Channel" ADD VALUE 'PINTEREST';
ALTER TYPE "Channel" ADD VALUE 'REDDIT';
ALTER TYPE "Channel" ADD VALUE 'NEXTDOOR';
ALTER TYPE "Channel" ADD VALUE 'SNAPCHAT';
ALTER TYPE "Channel" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "ChannelVariation" ADD COLUMN     "destinationId" TEXT;

-- CreateTable
CREATE TABLE "PublishDestination" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "brandId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "followers" INTEGER,
    "issues" TEXT[],
    "hue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PublishDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishDestination_brandId_channel_idx" ON "PublishDestination"("brandId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "PublishDestination_accountId_externalId_key" ON "PublishDestination"("accountId", "externalId");

-- AddForeignKey
ALTER TABLE "PublishDestination" ADD CONSTRAINT "PublishDestination_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishDestination" ADD CONSTRAINT "PublishDestination_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVariation" ADD CONSTRAINT "ChannelVariation_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "PublishDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;
