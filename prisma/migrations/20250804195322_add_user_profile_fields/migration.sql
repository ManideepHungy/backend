-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('ADULT', 'YOUTH', 'GROUP', 'CORPORATE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "ageBracket" TEXT,
ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "birthdate" TIMESTAMP(3),
ADD COLUMN     "canCallIfShortHanded" BOOLEAN DEFAULT true,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "communicationPreferences" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactNumber" TEXT,
ADD COLUMN     "frequency" TEXT,
ADD COLUMN     "homePhone" TEXT,
ADD COLUMN     "howDidYouHear" TEXT,
ADD COLUMN     "medicalConcerns" TEXT,
ADD COLUMN     "parentGuardianEmail" TEXT,
ADD COLUMN     "parentGuardianName" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "preferredDays" TEXT,
ADD COLUMN     "preferredPrograms" TEXT,
ADD COLUMN     "preferredShifts" TEXT,
ADD COLUMN     "profilePictureUrl" TEXT,
ADD COLUMN     "pronouns" TEXT,
ADD COLUMN     "registrationType" "RegistrationType" DEFAULT 'ADULT',
ADD COLUMN     "requiredHours" INTEGER,
ADD COLUMN     "schoolWorkCommitment" BOOLEAN DEFAULT false,
ADD COLUMN     "startDate" TIMESTAMP(3);
