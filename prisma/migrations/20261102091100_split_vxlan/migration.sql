-- 将 VLAN 上的可选 VXLAN 字段拆成独立资源
PRAGMA foreign_keys=OFF;
CREATE TABLE "Vxlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vni" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "vlanId" TEXT,
    "datacenterId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vxlan_vlanId_fkey" FOREIGN KEY ("vlanId") REFERENCES "Vlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Vxlan_datacenterId_fkey" FOREIGN KEY ("datacenterId") REFERENCES "Datacenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Vxlan_vni_key" ON "Vxlan"("vni");
CREATE UNIQUE INDEX "Vxlan_vlanId_key" ON "Vxlan"("vlanId");
CREATE INDEX "Vxlan_datacenterId_idx" ON "Vxlan"("datacenterId");

INSERT INTO "Vxlan" ("id", "vni", "name", "status", "description", "vlanId", "datacenterId", "createdAt", "updatedAt")
SELECT
    'vx_' || "id",
    "vxlanVni",
    "vxlanName",
    COALESCE("vxlanStatus", 'active'),
    "vxlanDescription",
    "id",
    "datacenterId",
    "createdAt",
    "updatedAt"
FROM "Vlan"
WHERE "vxlanVni" IS NOT NULL;

DROP INDEX "Vlan_vxlanVni_key";

ALTER TABLE "Vlan" DROP COLUMN "vxlanVni";
ALTER TABLE "Vlan" DROP COLUMN "vxlanName";
ALTER TABLE "Vlan" DROP COLUMN "vxlanStatus";
ALTER TABLE "Vlan" DROP COLUMN "vxlanDescription";
PRAGMA foreign_keys=ON;
