-- Drop existing foreign key constraint
ALTER TABLE "ShiftRegistrationFields" DROP CONSTRAINT IF EXISTS "ShiftRegistrationFields_shiftId_fkey";

-- Drop existing unique constraint
DROP INDEX IF EXISTS "ShiftRegistrationFields_shiftId_key";

-- Add new column for recurring shift reference
ALTER TABLE "ShiftRegistrationFields" ADD COLUMN "recurringShiftId" INTEGER;

-- Create unique constraint for recurring shift
CREATE UNIQUE INDEX "ShiftRegistrationFields_recurringShiftId_key" ON "ShiftRegistrationFields"("recurringShiftId");

-- Add foreign key constraint for recurring shift
ALTER TABLE "ShiftRegistrationFields" ADD CONSTRAINT "ShiftRegistrationFields_recurringShiftId_fkey" FOREIGN KEY ("recurringShiftId") REFERENCES "RecurringShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the old shiftId column
ALTER TABLE "ShiftRegistrationFields" DROP COLUMN "shiftId"; 