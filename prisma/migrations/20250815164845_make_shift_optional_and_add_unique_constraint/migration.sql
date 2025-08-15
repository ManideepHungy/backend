/*
  Warnings:

  - A unique constraint covering the columns `[donationId,categoryId]` on the table `DonationItem` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Donation" DROP CONSTRAINT "Donation_shiftId_fkey";

-- AlterTable
ALTER TABLE "Donation" ALTER COLUMN "shiftId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DonationItem_donationId_categoryId_key" ON "DonationItem"("donationId", "categoryId");

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
