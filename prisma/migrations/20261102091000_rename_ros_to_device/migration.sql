-- 将 ROS 设备统一改名为设备
ALTER TABLE "RosDevice" RENAME TO "Device";
ALTER TABLE "Device" RENAME COLUMN "rosVersion" TO "osVersion";

DROP INDEX "RosDevice_serialNo_key";
CREATE UNIQUE INDEX "Device_serialNo_key" ON "Device"("serialNo");

DROP INDEX "RosDevice_rackId_status_idx";
CREATE INDEX "Device_rackId_status_idx" ON "Device"("rackId", "status");

DROP INDEX "RosDevice_type_idx";
CREATE INDEX "Device_type_idx" ON "Device"("type");

DROP INDEX "RosDevice_warrantyEnd_idx";
CREATE INDEX "Device_warrantyEnd_idx" ON "Device"("warrantyEnd");

UPDATE "ChangeLog" SET "resource" = 'device' WHERE "resource" IN ('rosDevice', 'RosDevice');
