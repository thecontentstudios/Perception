-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "budgetCents" INTEGER,
ADD COLUMN     "budgetHardStop" BOOLEAN NOT NULL DEFAULT false;

