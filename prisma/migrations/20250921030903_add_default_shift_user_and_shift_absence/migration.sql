/*
  Warnings:

  - You are about to drop the column `contactInfo` on the `Donor` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Donor` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Donor` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name,organizationId]` on the table `Module` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `donationLocationId` to the `Donation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `donorType` to the `Donor` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organizationId` to the `Module` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('UNAVAILABLE', 'SICK_LEAVE', 'PERSONAL', 'VACATION', 'EMERGENCY');

-- DropForeignKey
ALTER TABLE "Donation" DROP CONSTRAINT "Donation_donorId_fkey";

-- DropIndex
DROP INDEX "Donor_name_key";

-- DropIndex
DROP INDEX "Module_name_key";

-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "donationLocationId" INTEGER NOT NULL,
ALTER COLUMN "donorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Donor" DROP COLUMN "contactInfo",
DROP COLUMN "location",
DROP COLUMN "name",
ADD COLUMN     "donorType" TEXT NOT NULL,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "organizationName" TEXT,
ADD COLUMN     "phoneNumber" TEXT;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "organizationId" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "DonationLocation" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "contactInfo" TEXT,
    "kitchenId" INTEGER NOT NULL,

    CONSTRAINT "DonationLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaultShiftUser" (
    "id" SERIAL NOT NULL,
    "recurringShiftId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefaultShiftUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAbsence" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "recurringShiftId" INTEGER,
    "organizationId" INTEGER NOT NULL,
    "absenceType" "AbsenceType" NOT NULL DEFAULT 'UNAVAILABLE',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" INTEGER,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DonationLocation_name_key" ON "DonationLocation"("name");

-- CreateIndex
CREATE INDEX "DefaultShiftUser_recurringShiftId_idx" ON "DefaultShiftUser"("recurringShiftId");

-- CreateIndex
CREATE INDEX "DefaultShiftUser_userId_idx" ON "DefaultShiftUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DefaultShiftUser_recurringShiftId_userId_key" ON "DefaultShiftUser"("recurringShiftId", "userId");

-- CreateIndex
CREATE INDEX "ShiftAbsence_recurringShiftId_idx" ON "ShiftAbsence"("recurringShiftId");

-- CreateIndex
CREATE INDEX "ShiftAbsence_userId_idx" ON "ShiftAbsence"("userId");

-- CreateIndex
CREATE INDEX "ShiftAbsence_shiftId_idx" ON "ShiftAbsence"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftAbsence_userId_shiftId_key" ON "ShiftAbsence"("userId", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Module_name_organizationId_key" ON "Module"("name", "organizationId");

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donationLocationId_fkey" FOREIGN KEY ("donationLocationId") REFERENCES "DonationLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "Donor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationLocation" ADD CONSTRAINT "DonationLocation_kitchenId_fkey" FOREIGN KEY ("kitchenId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultShiftUser" ADD CONSTRAINT "DefaultShiftUser_recurringShiftId_fkey" FOREIGN KEY ("recurringShiftId") REFERENCES "RecurringShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultShiftUser" ADD CONSTRAINT "DefaultShiftUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefaultShiftUser" ADD CONSTRAINT "DefaultShiftUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAbsence" ADD CONSTRAINT "ShiftAbsence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAbsence" ADD CONSTRAINT "ShiftAbsence_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAbsence" ADD CONSTRAINT "ShiftAbsence_recurringShiftId_fkey" FOREIGN KEY ("recurringShiftId") REFERENCES "RecurringShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAbsence" ADD CONSTRAINT "ShiftAbsence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAbsence" ADD CONSTRAINT "ShiftAbsence_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
