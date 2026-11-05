-- 机柜分配明细：区间分配的实际占用 U 位。
CREATE TABLE "RackAllocationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "allocationId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "uNumber" INTEGER NOT NULL,
    "releasedAt" DATETIME,
    "releaseBatchId" TEXT,
    "releaseNote" TEXT,
    "releasedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RackAllocationItem_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RackAllocationItem_allocationId_uNumber_key"
  ON "RackAllocationItem"("allocationId", "uNumber");
CREATE INDEX "RackAllocationItem_allocationId_releasedAt_idx"
  ON "RackAllocationItem"("allocationId", "releasedAt");
CREATE INDEX "RackAllocationItem_rackId_releasedAt_idx"
  ON "RackAllocationItem"("rackId", "releasedAt");
CREATE INDEX "RackAllocationItem_releaseBatchId_idx"
  ON "RackAllocationItem"("releaseBatchId");

-- 同一机柜记录下的每个 U 位最多只有一条有效分配。
CREATE UNIQUE INDEX "RackAllocationItem_active_unit_key"
  ON "RackAllocationItem"("rackId", "uNumber")
  WHERE "releasedAt" IS NULL;

-- 回填历史机柜区间分配：把 [uStart, uEnd] 展开成每个 U 位一条明细。
-- 已释放的区间保留明细，作为释放记录；releaseBatchId 使用 legacy-<allocationId>。
WITH RECURSIVE
  alloc AS (
    SELECT "id", "rackId", "uStart" AS startU, "uEnd" AS endU, "releasedAt"
    FROM "ResourceAllocation"
    WHERE "resourceType" = 'rack'
      AND "rackId" IS NOT NULL
      AND "uStart" IS NOT NULL
      AND "uEnd" IS NOT NULL
  ),
  units AS (
    SELECT "id", "rackId", "releasedAt", startU AS u, endU FROM alloc
    UNION ALL
    SELECT "id", "rackId", "releasedAt", u + 1, endU FROM units WHERE u < endU
  )
INSERT INTO "RackAllocationItem" (
  "id", "allocationId", "rackId", "uNumber", "releasedAt",
  "releaseBatchId", "releaseNote", "releasedByName", "createdAt", "updatedAt"
)
SELECT
  'rki_' || lower(hex(randomblob(12))),
  "id",
  "rackId",
  u,
  "releasedAt",
  CASE WHEN "releasedAt" IS NOT NULL THEN 'legacy-' || "id" ELSE NULL END,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM units;
