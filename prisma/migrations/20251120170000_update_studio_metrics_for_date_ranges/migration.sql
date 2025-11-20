-- AlterTable: Rename date column to startDate
ALTER TABLE "public"."studio_metrics" RENAME COLUMN "date" TO "startDate";

-- AlterTable: Add endDate column, initially set to same as startDate for existing rows
ALTER TABLE "public"."studio_metrics" ADD COLUMN "endDate" TIMESTAMP(3);

-- Update existing rows: set endDate to startDate (for single-day metrics)
UPDATE "public"."studio_metrics" SET "endDate" = "startDate" WHERE "endDate" IS NULL;

-- Make endDate NOT NULL now that all rows have values
ALTER TABLE "public"."studio_metrics" ALTER COLUMN "endDate" SET NOT NULL;

-- DropIndex: Remove old unique constraint
DROP INDEX IF EXISTS "studio_metrics_studioId_date_key";

-- CreateIndex: Add new unique constraint with startDate and endDate
CREATE UNIQUE INDEX "studio_metrics_studioId_startDate_endDate_key" ON "public"."studio_metrics"("studioId", "startDate", "endDate");

