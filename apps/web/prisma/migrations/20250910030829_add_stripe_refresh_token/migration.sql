-- AlterTable
ALTER TABLE "public"."studios" ADD COLUMN     "stripeConnectedAt" TIMESTAMP(3),
ADD COLUMN     "stripeLastManualSync" TIMESTAMP(3),
ADD COLUMN     "stripeRefreshToken" TEXT;
