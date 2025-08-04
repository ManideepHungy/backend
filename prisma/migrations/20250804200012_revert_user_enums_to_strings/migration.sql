/*
  Warnings:

  - The `ageBracket` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `communicationPreferences` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `frequency` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `howDidYouHear` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `pronouns` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "ageBracket",
ADD COLUMN     "ageBracket" TEXT,
DROP COLUMN "communicationPreferences",
ADD COLUMN     "communicationPreferences" TEXT,
DROP COLUMN "frequency",
ADD COLUMN     "frequency" TEXT,
DROP COLUMN "howDidYouHear",
ADD COLUMN     "howDidYouHear" TEXT,
DROP COLUMN "pronouns",
ADD COLUMN     "pronouns" TEXT;
