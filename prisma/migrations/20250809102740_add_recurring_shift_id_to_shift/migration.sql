/*
  Warnings:

  - Made the column `recurringShiftId` on table `ShiftRegistrationFields` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "recurringShiftId" INTEGER;

-- AlterTable
ALTER TABLE "ShiftRegistrationFields" ALTER COLUMN "recurringShiftId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_recurringShiftId_fkey" FOREIGN KEY ("recurringShiftId") REFERENCES "RecurringShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
