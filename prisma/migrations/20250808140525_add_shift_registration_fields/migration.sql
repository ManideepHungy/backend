-- CreateTable
CREATE TABLE "ShiftRegistrationFields" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "requireFirstName" BOOLEAN NOT NULL DEFAULT true,
    "requireLastName" BOOLEAN NOT NULL DEFAULT true,
    "requireEmail" BOOLEAN NOT NULL DEFAULT true,
    "requireAgeBracket" BOOLEAN NOT NULL DEFAULT false,
    "requireBirthdate" BOOLEAN NOT NULL DEFAULT false,
    "requirePronouns" BOOLEAN NOT NULL DEFAULT false,
    "requirePhone" BOOLEAN NOT NULL DEFAULT false,
    "requireAddress" BOOLEAN NOT NULL DEFAULT false,
    "requireCity" BOOLEAN NOT NULL DEFAULT false,
    "requirePostalCode" BOOLEAN NOT NULL DEFAULT false,
    "requireHomePhone" BOOLEAN NOT NULL DEFAULT false,
    "requireEmergencyContactName" BOOLEAN NOT NULL DEFAULT false,
    "requireEmergencyContactNumber" BOOLEAN NOT NULL DEFAULT false,
    "requireCommunicationPreferences" BOOLEAN NOT NULL DEFAULT false,
    "requireProfilePictureUrl" BOOLEAN NOT NULL DEFAULT false,
    "requireAllergies" BOOLEAN NOT NULL DEFAULT false,
    "requireMedicalConcerns" BOOLEAN NOT NULL DEFAULT false,
    "requirePreferredDays" BOOLEAN NOT NULL DEFAULT false,
    "requirePreferredShifts" BOOLEAN NOT NULL DEFAULT false,
    "requireFrequency" BOOLEAN NOT NULL DEFAULT false,
    "requirePreferredPrograms" BOOLEAN NOT NULL DEFAULT false,
    "requireCanCallIfShortHanded" BOOLEAN NOT NULL DEFAULT false,
    "requireSchoolWorkCommitment" BOOLEAN NOT NULL DEFAULT false,
    "requireRequiredHours" BOOLEAN NOT NULL DEFAULT false,
    "requireHowDidYouHear" BOOLEAN NOT NULL DEFAULT false,
    "requireStartDate" BOOLEAN NOT NULL DEFAULT false,
    "requireParentGuardianName" BOOLEAN NOT NULL DEFAULT false,
    "requireParentGuardianEmail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftRegistrationFields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShiftRegistrationFields_shiftId_key" ON "ShiftRegistrationFields"("shiftId");

-- AddForeignKey
ALTER TABLE "ShiftRegistrationFields" ADD CONSTRAINT "ShiftRegistrationFields_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE; 