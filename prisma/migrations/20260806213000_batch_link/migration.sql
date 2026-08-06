-- Where {{link}} points, captured at send time so a later CTA edit cannot rewrite a queued campaign.
-- AlterTable
ALTER TABLE "MessageBatch" ADD COLUMN     "linkUrl" TEXT;

