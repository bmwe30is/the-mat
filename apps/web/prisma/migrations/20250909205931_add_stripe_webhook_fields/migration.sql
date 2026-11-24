/*
  Warnings:

  - You are about to drop the column `fee` on the `stripe_payments` table. All the data in the column will be lost.
  - You are about to drop the column `netAmount` on the `stripe_payments` table. All the data in the column will be lost.
  - You are about to drop the column `processedAt` on the `stripe_payments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."stripe_payments" DROP COLUMN "fee",
DROP COLUMN "netAmount",
DROP COLUMN "processedAt";

-- AlterTable
ALTER TABLE "public"."studios" ADD COLUMN     "stripeWebhookId" TEXT,
ADD COLUMN     "stripeWebhookSecret" TEXT,
ADD COLUMN     "stripeWebhookUrl" TEXT;
