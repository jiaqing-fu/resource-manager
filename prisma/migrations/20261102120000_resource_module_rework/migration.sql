-- 资源管理重构：删除机房、拆分 VLAN/VXLAN、新增宽带与资源分配
PRAGMA foreign_keys=OFF;

-- 1. 删除机房前，用原机房名回填机柜空位置
UPDATE "Rack"
SET "location" = (
    SELECT "name" FROM "Datacenter" WHERE "Datacenter"."id" = "Rack"."datacenterId"
)
WHERE "location" IS NULL OR TRIM("location") = '';

-- 2. 新增宽带与资源分配
CREATE TABLE "Broadband" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "supplierId" TEXT,
    "customerId" TEXT,
    "bandwidthMbps" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expireDate" TEXT,
    "account" TEXT,
    "password" TEXT,
    "installAddress" TEXT,
    "rackId" TEXT,
    "deviceId" TEXT,
    "lineId" TEXT,
    "ipAddressId" TEXT,
    "monthlyFeeCents" INTEGER,
    "contractNo" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Broadband_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Broadband_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Broadband_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Broadband_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Broadband_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Broadband_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "IpAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ResourceAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "supplierName" TEXT,
    "activeKey" TEXT,
    "rackId" TEXT,
    "ipBlockId" TEXT,
    "ipAddressId" TEXT,
    "vlanId" TEXT,
    "vxlanId" TEXT,
    "broadbandId" TEXT,
    "lineId" TEXT,
    "deviceId" TEXT,
    "allocatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResourceAllocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_ipBlockId_fkey" FOREIGN KEY ("ipBlockId") REFERENCES "IpBlock" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "IpAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_vxlanId_fkey" FOREIGN KEY ("vxlanId") REFERENCES "Vxlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_broadbandId_fkey" FOREIGN KEY ("broadbandId") REFERENCES "Broadband" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- 3. 重建所有与机房有关系的表（去掉 datacenterId）
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'router',
    "role" TEXT NOT NULL DEFAULT 'access',
    "status" TEXT NOT NULL DEFAULT 'active',
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNo" TEXT,
    "assetTag" TEXT,
    "osVersion" TEXT,
    "mac" TEXT,
    "rackId" TEXT,
    "uStart" INTEGER,
    "uHeight" INTEGER NOT NULL DEFAULT 1,
    "face" TEXT NOT NULL DEFAULT 'front',
    "supplierId" TEXT,
    "customerId" TEXT,
    "owner" TEXT,
    "lastInventoryAt" TEXT,
    "purchaseDate" TEXT,
    "warrantyEnd" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Device_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Device_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("assetTag", "createdAt", "customerId", "face", "id", "lastInventoryAt", "mac", "manufacturer", "model", "name", "notes", "osVersion", "owner", "purchaseDate", "rackId", "role", "serialNo", "status", "supplierId", "type", "uHeight", "uStart", "updatedAt", "warrantyEnd") SELECT "assetTag", "createdAt", "customerId", "face", "id", "lastInventoryAt", "mac", "manufacturer", "model", "name", "notes", "osVersion", "owner", "purchaseDate", "rackId", "role", "serialNo", "status", "supplierId", "type", "uHeight", "uStart", "updatedAt", "warrantyEnd" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_serialNo_key" ON "Device"("serialNo");
CREATE INDEX "Device_rackId_status_idx" ON "Device"("rackId", "status");
CREATE INDEX "Device_type_idx" ON "Device"("type");
CREATE INDEX "Device_warrantyEnd_idx" ON "Device"("warrantyEnd");
CREATE TABLE "new_IpAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "blockId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "role" TEXT NOT NULL DEFAULT 'other',
    "supplierId" TEXT,
    "customerId" TEXT,
    "rackId" TEXT,
    "deviceId" TEXT,
    "lineId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "dnsName" TEXT,
    "description" TEXT,
    "assignedAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IpAddress_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "IpBlock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_IpAddress" ("address", "assignedAt", "blockId", "createdAt", "customerId", "description", "deviceId", "dnsName", "id", "isPrimary", "lineId", "rackId", "role", "status", "supplierId", "updatedAt") SELECT "address", "assignedAt", "blockId", "createdAt", "customerId", "description", "deviceId", "dnsName", "id", "isPrimary", "lineId", "rackId", "role", "status", "supplierId", "updatedAt" FROM "IpAddress";
DROP TABLE "IpAddress";
ALTER TABLE "new_IpAddress" RENAME TO "IpAddress";
CREATE UNIQUE INDEX "IpAddress_address_key" ON "IpAddress"("address");
CREATE INDEX "IpAddress_status_idx" ON "IpAddress"("status");
CREATE INDEX "IpAddress_blockId_idx" ON "IpAddress"("blockId");
CREATE INDEX "IpAddress_supplierId_idx" ON "IpAddress"("supplierId");
CREATE INDEX "IpAddress_customerId_idx" ON "IpAddress"("customerId");
CREATE INDEX "IpAddress_deviceId_idx" ON "IpAddress"("deviceId");
CREATE INDEX "IpAddress_lineId_idx" ON "IpAddress"("lineId");
CREATE TABLE "new_IpBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cidr" TEXT NOT NULL,
    "parentId" TEXT,
    "ipVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "role" TEXT NOT NULL DEFAULT 'other',
    "vlanId" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "gateway" TEXT,
    "description" TEXT,
    "assignedAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IpBlock_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IpBlock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_IpBlock" ("assignedAt", "cidr", "createdAt", "customerId", "description", "gateway", "id", "ipVersion", "parentId", "role", "status", "supplierId", "updatedAt", "vlanId") SELECT "assignedAt", "cidr", "createdAt", "customerId", "description", "gateway", "id", "ipVersion", "parentId", "role", "status", "supplierId", "updatedAt", "vlanId" FROM "IpBlock";
DROP TABLE "IpBlock";
ALTER TABLE "new_IpBlock" RENAME TO "IpBlock";
CREATE UNIQUE INDEX "IpBlock_cidr_key" ON "IpBlock"("cidr");
CREATE INDEX "IpBlock_parentId_status_idx" ON "IpBlock"("parentId", "status");
CREATE INDEX "IpBlock_supplierId_idx" ON "IpBlock"("supplierId");
CREATE INDEX "IpBlock_customerId_idx" ON "IpBlock"("customerId");
CREATE INDEX "IpBlock_vlanId_idx" ON "IpBlock"("vlanId");
CREATE TABLE "new_LineTermination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "rackId" TEXT,
    "deviceId" TEXT,
    "port" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LineTermination_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineTermination_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LineTermination_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LineTermination" ("createdAt", "description", "deviceId", "id", "lineId", "port", "rackId", "side", "updatedAt") SELECT "createdAt", "description", "deviceId", "id", "lineId", "port", "rackId", "side", "updatedAt" FROM "LineTermination";
DROP TABLE "LineTermination";
ALTER TABLE "new_LineTermination" RENAME TO "LineTermination";
CREATE INDEX "LineTermination_deviceId_idx" ON "LineTermination"("deviceId");
CREATE UNIQUE INDEX "LineTermination_lineId_side_key" ON "LineTermination"("lineId", "side");
CREATE TABLE "new_Rack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "location" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "width" INTEGER NOT NULL DEFAULT 19,
    "totalU" INTEGER NOT NULL DEFAULT 42,
    "power" TEXT,
    "serial" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rack_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Rack_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Rack" ("code", "createdAt", "customerId", "id", "location", "notes", "power", "serial", "status", "supplierId", "totalU", "updatedAt", "width") SELECT "code", "createdAt", "customerId", "id", "location", "notes", "power", "serial", "status", "supplierId", "totalU", "updatedAt", "width" FROM "Rack";
DROP TABLE "Rack";
ALTER TABLE "new_Rack" RENAME TO "Rack";
CREATE UNIQUE INDEX "Rack_code_key" ON "Rack"("code");
CREATE INDEX "Rack_status_idx" ON "Rack"("status");
CREATE INDEX "Rack_supplierId_idx" ON "Rack"("supplierId");
CREATE INDEX "Rack_customerId_idx" ON "Rack"("customerId");
CREATE TABLE "new_Vlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vid" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vlan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Vlan" ("createdAt", "description", "id", "name", "status", "updatedAt", "vid") SELECT "createdAt", "description", "id", "name", "status", "updatedAt", "vid" FROM "Vlan";
DROP TABLE "Vlan";
ALTER TABLE "new_Vlan" RENAME TO "Vlan";
CREATE INDEX "Vlan_supplierId_idx" ON "Vlan"("supplierId");
CREATE INDEX "Vlan_customerId_idx" ON "Vlan"("customerId");
CREATE UNIQUE INDEX "Vlan_supplierId_vid_key" ON "Vlan"("supplierId", "vid");
CREATE TABLE "new_Vxlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vni" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "vlanId" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vxlan_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Vxlan_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vxlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Vxlan" ("createdAt", "description", "id", "name", "status", "updatedAt", "vlanId", "vni") SELECT "createdAt", "description", "id", "name", "status", "updatedAt", "vlanId", "vni" FROM "Vxlan";
DROP TABLE "Vxlan";
ALTER TABLE "new_Vxlan" RENAME TO "Vxlan";
CREATE UNIQUE INDEX "Vxlan_vni_key" ON "Vxlan"("vni");
CREATE UNIQUE INDEX "Vxlan_vlanId_key" ON "Vxlan"("vlanId");
CREATE INDEX "Vxlan_supplierId_idx" ON "Vxlan"("supplierId");
CREATE INDEX "Vxlan_customerId_idx" ON "Vxlan"("customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 4. 新表索引
CREATE UNIQUE INDEX "Broadband_name_key" ON "Broadband"("name");
CREATE INDEX "Broadband_supplierId_idx" ON "Broadband"("supplierId");
CREATE INDEX "Broadband_customerId_idx" ON "Broadband"("customerId");
CREATE INDEX "Broadband_status_expireDate_idx" ON "Broadband"("status", "expireDate");
CREATE UNIQUE INDEX "ResourceAllocation_activeKey_key" ON "ResourceAllocation"("activeKey");
CREATE INDEX "ResourceAllocation_customerId_allocatedAt_idx" ON "ResourceAllocation"("customerId", "allocatedAt");
CREATE INDEX "ResourceAllocation_customerId_releasedAt_idx" ON "ResourceAllocation"("customerId", "releasedAt");
CREATE INDEX "ResourceAllocation_resourceType_releasedAt_idx" ON "ResourceAllocation"("resourceType", "releasedAt");
CREATE INDEX "ResourceAllocation_rackId_idx" ON "ResourceAllocation"("rackId");
CREATE INDEX "ResourceAllocation_ipBlockId_idx" ON "ResourceAllocation"("ipBlockId");
CREATE INDEX "ResourceAllocation_ipAddressId_idx" ON "ResourceAllocation"("ipAddressId");
CREATE INDEX "ResourceAllocation_vlanId_idx" ON "ResourceAllocation"("vlanId");
CREATE INDEX "ResourceAllocation_vxlanId_idx" ON "ResourceAllocation"("vxlanId");
CREATE INDEX "ResourceAllocation_broadbandId_idx" ON "ResourceAllocation"("broadbandId");
CREATE INDEX "ResourceAllocation_lineId_idx" ON "ResourceAllocation"("lineId");
CREATE INDEX "ResourceAllocation_deviceId_idx" ON "ResourceAllocation"("deviceId");

-- 5. 把历史 customerId 回填为资源分配记录
INSERT INTO "ResourceAllocation" (
    "id", "customerId", "resourceType", "resourceName", "supplierName", "activeKey",
    "rackId", "ipBlockId", "ipAddressId", "vlanId", "vxlanId", "broadbandId", "lineId", "deviceId",
    "allocatedAt", "releasedAt", "notes", "createdAt", "updatedAt"
)
SELECT
    'ra_rack_' || "id", "customerId", 'rack', "code",
    (SELECT "name" FROM "Supplier" WHERE "Supplier"."id" = "Rack"."supplierId"),
    'rack:' || "id",
    "id", NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    "createdAt", NULL, '由历史 customerId 回填', "createdAt", "updatedAt"
FROM "Rack" WHERE "customerId" IS NOT NULL;

INSERT INTO "ResourceAllocation" (
    "id", "customerId", "resourceType", "resourceName", "supplierName", "activeKey",
    "rackId", "ipBlockId", "ipAddressId", "vlanId", "vxlanId", "broadbandId", "lineId", "deviceId",
    "allocatedAt", "releasedAt", "notes", "createdAt", "updatedAt"
)
SELECT
    'ra_device_' || "id", "customerId", 'device', "name",
    (SELECT "name" FROM "Supplier" WHERE "Supplier"."id" = "Device"."supplierId"),
    'device:' || "id",
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, "id",
    "createdAt", NULL, '由历史 customerId 回填', "createdAt", "updatedAt"
FROM "Device" WHERE "customerId" IS NOT NULL;

INSERT INTO "ResourceAllocation" (
    "id", "customerId", "resourceType", "resourceName", "supplierName", "activeKey",
    "rackId", "ipBlockId", "ipAddressId", "vlanId", "vxlanId", "broadbandId", "lineId", "deviceId",
    "allocatedAt", "releasedAt", "notes", "createdAt", "updatedAt"
)
SELECT
    'ra_line_' || "id", "customerId", 'line', "code" || ' ' || "name",
    (SELECT "name" FROM "Supplier" WHERE "Supplier"."id" = "Line"."supplierId"),
    'line:' || "id",
    NULL, NULL, NULL, NULL, NULL, NULL, "id", NULL,
    "createdAt", NULL, '由历史 customerId 回填', "createdAt", "updatedAt"
FROM "Line" WHERE "customerId" IS NOT NULL;

INSERT INTO "ResourceAllocation" (
    "id", "customerId", "resourceType", "resourceName", "supplierName", "activeKey",
    "rackId", "ipBlockId", "ipAddressId", "vlanId", "vxlanId", "broadbandId", "lineId", "deviceId",
    "allocatedAt", "releasedAt", "notes", "createdAt", "updatedAt"
)
SELECT
    'ra_ipAddress_' || "id", "customerId", 'ipAddress', "address",
    (SELECT "name" FROM "Supplier" WHERE "Supplier"."id" = "IpAddress"."supplierId"),
    'ipAddress:' || "id",
    NULL, NULL, "id", NULL, NULL, NULL, NULL, NULL,
    "createdAt", NULL, '由历史 customerId 回填', "createdAt", "updatedAt"
FROM "IpAddress" WHERE "customerId" IS NOT NULL;

INSERT INTO "ResourceAllocation" (
    "id", "customerId", "resourceType", "resourceName", "supplierName", "activeKey",
    "rackId", "ipBlockId", "ipAddressId", "vlanId", "vxlanId", "broadbandId", "lineId", "deviceId",
    "allocatedAt", "releasedAt", "notes", "createdAt", "updatedAt"
)
SELECT
    'ra_ipBlock_' || "id", "customerId", 'ipBlock', "cidr",
    (SELECT "name" FROM "Supplier" WHERE "Supplier"."id" = "IpBlock"."supplierId"),
    'ipBlock:' || "id",
    NULL, "id", NULL, NULL, NULL, NULL, NULL, NULL,
    "createdAt", NULL, '由历史 customerId 回填', "createdAt", "updatedAt"
FROM "IpBlock" WHERE "customerId" IS NOT NULL;

-- 6. 删除机房
DROP TABLE "Datacenter";

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
