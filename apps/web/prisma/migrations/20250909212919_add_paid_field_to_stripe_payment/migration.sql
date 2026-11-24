/*
  Warnings:

  - Added the required column `paid` to the `stripe_payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `stripe_payments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."stripe_payments" ADD COLUMN     "paid" BOOLEAN NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
