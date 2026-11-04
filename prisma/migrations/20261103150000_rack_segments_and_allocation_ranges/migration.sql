-- 机柜区间化 + 资源分配子区间 / 宽带 MBPS
-- 一条 Rack 记录代表物理机柜的一段 U 区间；历史数据回填为 [1, 原 totalU]。
PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

-- 1. 重建 Rack：删除 totalU，新增 uStart / uEnd，code 不再全局唯一
CREATE TABLE "new_Rack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "location" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "width" INTEGER NOT NULL DEFAULT 19,
    "uStart" INTEGER NOT NULL DEFAULT 1,
    "uEnd" INTEGER NOT NULL DEFAULT 42,
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

-- 历史记录占满原机柜：uStart=1，uEnd=原 totalU；ID 不变，外键继续有效。
INSERT INTO "new_Rack" ("code", "createdAt", "customerId", "id", "location", "notes", "power", "serial", "status", "supplierId", "uStart", "uEnd", "updatedAt", "width")
SELECT "code", "createdAt", "customerId", "id", "location", "notes", "power", "serial", "status", "supplierId", 1, "totalU", "updatedAt", "width" FROM "Rack";

DROP TABLE "Rack";
ALTER TABLE "new_Rack" RENAME TO "Rack";

CREATE UNIQUE INDEX "Rack_code_uStart_uEnd_key" ON "Rack"("code", "uStart", "uEnd");
CREATE INDEX "Rack_code_idx" ON "Rack"("code");
CREATE INDEX "Rack_status_idx" ON "Rack"("status");
CREATE INDEX "Rack_supplierId_idx" ON "Rack"("supplierId");
CREATE INDEX "Rack_customerId_idx" ON "Rack"("customerId");

-- 2. 资源分配新增：机柜子区间与宽带 MBPS
ALTER TABLE "ResourceAllocation" ADD COLUMN "uStart" INTEGER;
ALTER TABLE "ResourceAllocation" ADD COLUMN "uEnd" INTEGER;
ALTER TABLE "ResourceAllocation" ADD COLUMN "allocatedMbps" INTEGER;

-- 3. 历史机柜分配占满迁移后的机柜区间，并在快照名称后追加区间
UPDATE "ResourceAllocation"
SET "uStart" = (SELECT "Rack"."uStart" FROM "Rack" WHERE "Rack"."id" = "ResourceAllocation"."rackId"),
    "uEnd" = (SELECT "Rack"."uEnd" FROM "Rack" WHERE "Rack"."id" = "ResourceAllocation"."rackId")
WHERE "resourceType" = 'rack' AND "rackId" IS NOT NULL;

UPDATE "ResourceAllocation"
SET "resourceName" = "resourceName" || ' [' || "uStart" || '-' || "uEnd" || ']U'
WHERE "resourceType" = 'rack'
  AND "rackId" IS NOT NULL
  AND "uStart" IS NOT NULL
  AND "uEnd" IS NOT NULL;

-- 4. 历史宽带分配按当前总带宽回填 MBPS；总带宽未知时保持 NULL
UPDATE "ResourceAllocation"
SET "allocatedMbps" = (SELECT "Broadband"."bandwidthMbps" FROM "Broadband" WHERE "Broadband"."id" = "ResourceAllocation"."broadbandId")
WHERE "resourceType" = 'broadband' AND "broadbandId" IS NOT NULL;

-- 5. 机柜 / 宽带允许多条有效分配，不再使用 activeKey 唯一键
UPDATE "ResourceAllocation"
SET "activeKey" = NULL
WHERE "resourceType" IN ('rack', 'broadband');

-- 6. 区间查询索引
CREATE INDEX "ResourceAllocation_rackId_releasedAt_idx" ON "ResourceAllocation"("rackId", "releasedAt");
CREATE INDEX "ResourceAllocation_broadbandId_releasedAt_idx" ON "ResourceAllocation"("broadbandId", "releasedAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
PRAGMA foreign_key_check;
