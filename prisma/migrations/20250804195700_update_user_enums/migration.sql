/*
  Warnings:

  - The values [YOUTH,GROUP,CORPORATE] on the enum `RegistrationType` will be removed. If these variants are still used in the database, this will fail.
  - The `ageBracket` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `communicationPreferences` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `frequency` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `howDidYouHear` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `pronouns` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "AgeBracket" AS ENUM ('UNDER_16', 'AGE_16_29', 'AGE_30_39', 'AGE_40_49', 'AGE_50_59', 'AGE_60_69', 'AGE_70_PLUS');

-- CreateEnum
CREATE TYPE "Pronouns" AS ENUM ('HE_HIM', 'SHE_HER', 'THEY_THEM', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "CommunicationPreference" AS ENUM ('EMAIL', 'SMS', 'APP_NOTIFICATION');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('WEEKLY', 'BI_WEEKLY', 'MONTHLY', 'DAILY', 'ONCE', 'WHEN_TIME_PERMITS');

-- CreateEnum
CREATE TYPE "HowDidYouHear" AS ENUM ('FAMILY_FRIENDS', 'GOOGLE', 'SOCIAL_MEDIA', 'CONNECT_FREDERICTON', 'SCHOOL', 'WORK', 'NOTICE_BOARDS', 'EVENTS');

-- AlterEnum
BEGIN;
CREATE TYPE "RegistrationType_new" AS ENUM ('ADULT', 'MINOR');
ALTER TABLE "User" ALTER COLUMN "registrationType" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "registrationType" TYPE "RegistrationType_new" USING ("registrationType"::text::"RegistrationType_new");
ALTER TYPE "RegistrationType" RENAME TO "RegistrationType_old";
ALTER TYPE "RegistrationType_new" RENAME TO "RegistrationType";
DROP TYPE "RegistrationType_old";
ALTER TABLE "User" ALTER COLUMN "registrationType" SET DEFAULT 'ADULT';
COMMIT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "ageBracket",
ADD COLUMN     "ageBracket" "AgeBracket",
DROP COLUMN "communicationPreferences",
ADD COLUMN     "communicationPreferences" "CommunicationPreference",
DROP COLUMN "frequency",
ADD COLUMN     "frequency" "Frequency",
DROP COLUMN "howDidYouHear",
ADD COLUMN     "howDidYouHear" "HowDidYouHear",
DROP COLUMN "pronouns",
ADD COLUMN     "pronouns" "Pronouns";
