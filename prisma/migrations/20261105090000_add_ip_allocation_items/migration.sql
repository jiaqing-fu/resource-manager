-- IP 分配明细：区间分配的实际占用单元。
CREATE TABLE "ResourceAllocationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "allocationId" TEXT NOT NULL,
    "ipAddressId" TEXT,
    "address" TEXT NOT NULL,
    "releasedAt" DATETIME,
    "releaseBatchId" TEXT,
    "releaseNote" TEXT,
    "releasedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResourceAllocationItem_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ResourceAllocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResourceAllocationItem_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "IpAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ResourceAllocationItem_allocationId_address_key"
  ON "ResourceAllocationItem"("allocationId", "address");
CREATE INDEX "ResourceAllocationItem_allocationId_releasedAt_idx"
  ON "ResourceAllocationItem"("allocationId", "releasedAt");
CREATE INDEX "ResourceAllocationItem_address_releasedAt_idx"
  ON "ResourceAllocationItem"("address", "releasedAt");
CREATE INDEX "ResourceAllocationItem_ipAddressId_idx"
  ON "ResourceAllocationItem"("ipAddressId");
CREATE INDEX "ResourceAllocationItem_releaseBatchId_idx"
  ON "ResourceAllocationItem"("releaseBatchId");

-- 同一 IP 最多只有一条有效分配；部分唯一索引由 SQLite 支持。
CREATE UNIQUE INDEX "ResourceAllocationItem_active_address_key"
  ON "ResourceAllocationItem"("address")
  WHERE "releasedAt" IS NULL;

-- 回填历史区间分配：把 start-end 展开成每个 IP 一条明细。
-- 已释放的区间保留明细，作为释放记录；releaseBatchId 使用 legacy-<allocationId>。
WITH RECURSIVE
  alloc AS (
    SELECT "id", "ipRangeStart" AS startIp, "ipRangeEnd" AS endIp, "releasedAt"
    FROM "ResourceAllocation"
    WHERE "resourceType" = 'ipRange'
      AND "ipRangeStart" IS NOT NULL
      AND "ipRangeEnd" IS NOT NULL
  ),
  split AS (
    SELECT "id", "releasedAt", 0 AS which, startIp AS rest, 0 AS idx FROM alloc
    UNION ALL
    SELECT "id", "releasedAt", 1 AS which, endIp AS rest, 0 AS idx FROM alloc
    UNION ALL
    SELECT "id", "releasedAt", which, substr(rest, instr(rest, '.') + 1), idx + 1
    FROM split
    WHERE instr(rest, '.') > 0
  ),
  octets AS (
    SELECT
      "id",
      "releasedAt",
      which,
      idx,
      CAST(
        CASE WHEN instr(rest, '.') > 0
          THEN substr(rest, 1, instr(rest, '.') - 1)
          ELSE rest
        END AS INTEGER
      ) AS octet
    FROM split
  ),
  parsed AS (
    SELECT
      "id",
      "releasedAt",
      SUM(
        CASE WHEN which = 0
          THEN octet * CASE idx WHEN 0 THEN 16777216 WHEN 1 THEN 65536 WHEN 2 THEN 256 ELSE 1 END
          ELSE 0
        END
      ) AS startLong,
      SUM(
        CASE WHEN which = 1
          THEN octet * CASE idx WHEN 0 THEN 16777216 WHEN 1 THEN 65536 WHEN 2 THEN 256 ELSE 1 END
          ELSE 0
        END
      ) AS endLong
    FROM octets
    GROUP BY "id"
  ),
  nums AS (
    SELECT "id", "releasedAt", startLong AS n, endLong FROM parsed
    UNION ALL
    SELECT "id", "releasedAt", n + 1, endLong FROM nums WHERE n < endLong
  )
INSERT INTO "ResourceAllocationItem" (
  "id", "allocationId", "ipAddressId", "address", "releasedAt",
  "releaseBatchId", "releaseNote", "releasedByName", "createdAt", "updatedAt"
)
SELECT
  'rai_' || lower(hex(randomblob(12))),
  nums."id",
  (
    SELECT ip."id" FROM "IpAddress" ip
    WHERE ip."address" =
      ((nums.n >> 24) & 255) || '.' ||
      ((nums.n >> 16) & 255) || '.' ||
      ((nums.n >> 8) & 255) || '.' ||
      (nums.n & 255)
  ),
  ((nums.n >> 24) & 255) || '.' ||
  ((nums.n >> 16) & 255) || '.' ||
  ((nums.n >> 8) & 255) || '.' ||
  (nums.n & 255),
  nums."releasedAt",
  CASE WHEN nums."releasedAt" IS NOT NULL THEN 'legacy-' || nums."id" ELSE NULL END,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM nums;
