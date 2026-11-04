-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parentId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "asn" INTEGER,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Supplier_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parentId" TEXT,
    "salesperson" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "wechat" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Datacenter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "region" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Rack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datacenterId" TEXT NOT NULL,
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
    CONSTRAINT "Rack_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Rack_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Rack_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "datacenterId" TEXT,
    "vid" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vlan_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IpBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cidr" TEXT NOT NULL,
    "parentId" TEXT,
    "ipVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "role" TEXT NOT NULL DEFAULT 'other',
    "vlanId" TEXT,
    "datacenterId" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "gateway" TEXT,
    "description" TEXT,
    "assignedAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IpBlock_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IpBlock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpBlock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IpAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "blockId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "role" TEXT NOT NULL DEFAULT 'other',
    "supplierId" TEXT,
    "customerId" TEXT,
    "datacenterId" TEXT,
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
    CONSTRAINT "IpAddress_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "RosDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IpAddress_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RosDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'router',
    "role" TEXT NOT NULL DEFAULT 'access',
    "status" TEXT NOT NULL DEFAULT 'active',
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNo" TEXT,
    "assetTag" TEXT,
    "rosVersion" TEXT,
    "mac" TEXT,
    "datacenterId" TEXT,
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
    CONSTRAINT "RosDevice_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RosDevice_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RosDevice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RosDevice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Line" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'internet',
    "status" TEXT NOT NULL DEFAULT 'active',
    "supplierId" TEXT,
    "customerId" TEXT,
    "bandwidthMbps" INTEGER,
    "monthlyFeeCents" INTEGER,
    "circuitNo" TEXT,
    "installDate" TEXT,
    "expireDate" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Line_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Line_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineTermination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "datacenterId" TEXT,
    "rackId" TEXT,
    "deviceId" TEXT,
    "port" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LineTermination_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineTermination_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LineTermination_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LineTermination_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "RosDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessSystem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "owner" TEXT NOT NULL,
    "department" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'prod',
    "criticality" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "url" TEXT,
    "domain" TEXT,
    "onlineDate" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BusinessSystemEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "systemId" TEXT NOT NULL,
    "ipAddressId" TEXT,
    "ipText" TEXT,
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "port" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessSystemEndpoint_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "BusinessSystem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessSystemEndpoint_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "IpAddress" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seqNo" INTEGER NOT NULL,
    "customerId" TEXT,
    "companyName" TEXT NOT NULL,
    "salesperson" TEXT,
    "content" TEXT,
    "startAt" TEXT NOT NULL,
    "endAt" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerTest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Supplier_level_parentId_idx" ON "Supplier"("level", "parentId");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Customer_level_parentId_idx" ON "Customer"("level", "parentId");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Datacenter_name_key" ON "Datacenter"("name");

-- CreateIndex
CREATE INDEX "Rack_status_idx" ON "Rack"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Rack_datacenterId_code_key" ON "Rack"("datacenterId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Vlan_datacenterId_vid_key" ON "Vlan"("datacenterId", "vid");

-- CreateIndex
CREATE UNIQUE INDEX "IpBlock_cidr_key" ON "IpBlock"("cidr");

-- CreateIndex
CREATE INDEX "IpBlock_parentId_status_idx" ON "IpBlock"("parentId", "status");

-- CreateIndex
CREATE INDEX "IpBlock_supplierId_idx" ON "IpBlock"("supplierId");

-- CreateIndex
CREATE INDEX "IpBlock_customerId_idx" ON "IpBlock"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "IpAddress_address_key" ON "IpAddress"("address");

-- CreateIndex
CREATE INDEX "IpAddress_status_idx" ON "IpAddress"("status");

-- CreateIndex
CREATE INDEX "IpAddress_deviceId_idx" ON "IpAddress"("deviceId");

-- CreateIndex
CREATE INDEX "IpAddress_lineId_idx" ON "IpAddress"("lineId");

-- CreateIndex
CREATE INDEX "IpAddress_supplierId_idx" ON "IpAddress"("supplierId");

-- CreateIndex
CREATE INDEX "IpAddress_customerId_idx" ON "IpAddress"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "RosDevice_serialNo_key" ON "RosDevice"("serialNo");

-- CreateIndex
CREATE INDEX "RosDevice_rackId_status_idx" ON "RosDevice"("rackId", "status");

-- CreateIndex
CREATE INDEX "RosDevice_type_idx" ON "RosDevice"("type");

-- CreateIndex
CREATE INDEX "RosDevice_warrantyEnd_idx" ON "RosDevice"("warrantyEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Line_code_key" ON "Line"("code");

-- CreateIndex
CREATE INDEX "Line_status_idx" ON "Line"("status");

-- CreateIndex
CREATE INDEX "Line_expireDate_idx" ON "Line"("expireDate");

-- CreateIndex
CREATE INDEX "LineTermination_deviceId_idx" ON "LineTermination"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LineTermination_lineId_side_key" ON "LineTermination"("lineId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSystem_code_key" ON "BusinessSystem"("code");

-- CreateIndex
CREATE INDEX "BusinessSystem_status_idx" ON "BusinessSystem"("status");

-- CreateIndex
CREATE INDEX "BusinessSystemEndpoint_systemId_idx" ON "BusinessSystemEndpoint"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerTest_seqNo_key" ON "CustomerTest"("seqNo");

-- CreateIndex
CREATE INDEX "CustomerTest_endAt_status_idx" ON "CustomerTest"("endAt", "status");

-- CreateIndex
CREATE INDEX "CustomerTest_customerId_idx" ON "CustomerTest"("customerId");

-- CreateIndex
CREATE INDEX "CustomerTest_salesperson_idx" ON "CustomerTest"("salesperson");

-- CreateIndex
CREATE INDEX "ChangeLog_resource_recordId_idx" ON "ChangeLog"("resource", "recordId");

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt");
