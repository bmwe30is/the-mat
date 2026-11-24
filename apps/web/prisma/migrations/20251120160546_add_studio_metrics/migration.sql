-- CreateTable
CREATE TABLE "public"."studio_metrics" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalRevenue" DECIMAL(10,2) NOT NULL,
    "totalProfit" DECIMAL(10,2) NOT NULL,
    "processingFees" DECIMAL(10,2) NOT NULL,
    "avgTransactionSize" DECIMAL(10,2) NOT NULL,
    "totalBookings" INTEGER NOT NULL,
    "totalAttendees" INTEGER NOT NULL,
    "utilizationRate" DECIMAL(5,2) NOT NULL,
    "profitPerCustomer" DECIMAL(10,2) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studio_metrics_studioId_date_key" ON "public"."studio_metrics"("studioId", "date");

-- AddForeignKey
ALTER TABLE "public"."studio_metrics" ADD CONSTRAINT "studio_metrics_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "public"."studios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
