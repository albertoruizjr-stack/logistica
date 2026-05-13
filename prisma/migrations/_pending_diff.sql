-- DropForeignKey
ALTER TABLE "delivery_status_history" DROP CONSTRAINT "delivery_status_history_deliveryRequestId_fkey";

-- DropForeignKey
ALTER TABLE "operational_metrics_snapshots" DROP CONSTRAINT "oms_deliveryRequestId_fkey";

-- AlterTable
ALTER TABLE "delivery_items" DROP COLUMN "available_stock",
DROP COLUMN "days_without_sale",
DROP COLUMN "fetched_at",
DROP COLUMN "gross_weight",
DROP COLUMN "has_missing_weight",
DROP COLUMN "physical_stock",
DROP COLUMN "stock_status",
DROP COLUMN "total_weight",
DROP COLUMN "turnover_class",
ALTER COLUMN "fetchedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "delivery_requests" DROP COLUMN "delivery_state",
DROP COLUMN "has_missing_weights",
DROP COLUMN "outside_s_p_approval_reason",
DROP COLUMN "outside_s_p_approved",
DROP COLUMN "outside_s_p_approved_at",
DROP COLUMN "outside_s_p_approved_by",
DROP COLUMN "stock_fetched_at",
DROP COLUMN "stock_validation_status",
DROP COLUMN "total_latas",
DROP COLUMN "total_weight_kg",
ADD COLUMN     "customerAddressSnapshot" TEXT,
ADD COLUMN     "deliveryAddressEditedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAddressEditedById" TEXT,
ADD COLUMN     "deliveryAddressOriginal" TEXT,
ADD COLUMN     "deliveryAddressSnapshot" TEXT,
ADD COLUMN     "deliveryAddressSource" TEXT,
ADD COLUMN     "erpOrderStatus" TEXT,
ADD COLUMN     "erpOrderValidationStatus" TEXT,
ALTER COLUMN "deliveryState" SET DATA TYPE TEXT,
ALTER COLUMN "outsideSPApprovedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "stockFetchedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "dispatches" DROP COLUMN "predicted_delivery_at",
ALTER COLUMN "predictedDeliveryAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "freight_quotes" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "convertedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "scheduledFor" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "route_cache" DROP COLUMN "source";

-- AddForeignKey
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_deliveryRequestId_fkey" FOREIGN KEY ("deliveryRequestId") REFERENCES "delivery_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_metrics_snapshots" ADD CONSTRAINT "operational_metrics_snapshots_deliveryRequestId_fkey" FOREIGN KEY ("deliveryRequestId") REFERENCES "delivery_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "oms_deliveryRequestId_enteredAt_idx" RENAME TO "operational_metrics_snapshots_deliveryRequestId_enteredAt_idx";

-- RenameIndex
ALTER INDEX "oms_exitedAt_idx" RENAME TO "operational_metrics_snapshots_exitedAt_idx";

-- RenameIndex
ALTER INDEX "oms_operatorId_enteredAt_idx" RENAME TO "operational_metrics_snapshots_operatorId_enteredAt_idx";

-- RenameIndex
ALTER INDEX "oms_status_enteredAt_idx" RENAME TO "operational_metrics_snapshots_status_enteredAt_idx";

-- RenameIndex
ALTER INDEX "oms_storeId_enteredAt_idx" RENAME TO "operational_metrics_snapshots_storeId_enteredAt_idx";

