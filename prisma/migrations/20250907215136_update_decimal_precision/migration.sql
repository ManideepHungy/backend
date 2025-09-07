/*
  Warnings:

  - You are about to alter the column `incoming_dollar_value` on the `Organization` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.
  - You are about to alter the column `mealsvalue` on the `Organization` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE "Organization" ALTER COLUMN "incoming_dollar_value" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "mealsvalue" SET DATA TYPE DECIMAL(10,2);
