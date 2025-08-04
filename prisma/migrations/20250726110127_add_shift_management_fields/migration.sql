/*
  Warnings:

  - You are about to drop the column `noofmeals` on the `WeighingCategory` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- AlterTable
ALTER TABLE "RecurringShift" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "dayOfWeek" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" INTEGER,
ADD COLUMN     "denialReason" TEXT,
ADD COLUMN     "deniedAt" TIMESTAMP(3),
ADD COLUMN     "deniedBy" INTEGER,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "WeighingCategory" DROP COLUMN "noofmeals";

-- CreateTable
CREATE TABLE "Module" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsAndConditions" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER,

    CONSTRAINT "TermsAndConditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAgreement" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "termsAndConditionsId" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "signedDocumentUrl" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserModulePermission" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "canAccess" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UserModulePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Module_name_key" ON "Module"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TermsAndConditions_organizationId_version_key" ON "TermsAndConditions"("organizationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "UserAgreement_userId_organizationId_termsAndConditionsId_key" ON "UserAgreement"("userId", "organizationId", "termsAndConditionsId");

-- CreateIndex
CREATE UNIQUE INDEX "UserModulePermission_userId_organizationId_moduleId_key" ON "UserModulePermission"("userId", "organizationId", "moduleId");

-- AddForeignKey
ALTER TABLE "TermsAndConditions" ADD CONSTRAINT "TermsAndConditions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgreement" ADD CONSTRAINT "UserAgreement_termsAndConditionsId_fkey" FOREIGN KEY ("termsAndConditionsId") REFERENCES "TermsAndConditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgreement" ADD CONSTRAINT "UserAgreement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserModulePermission" ADD CONSTRAINT "UserModulePermission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserModulePermission" ADD CONSTRAINT "UserModulePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
