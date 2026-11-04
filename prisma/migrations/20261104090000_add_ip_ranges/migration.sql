-- IP 区间段：cidr 仍保存唯一展示键（CIDR 或 start-end）
ALTER TABLE "IpBlock" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'cidr';
ALTER TABLE "IpBlock" ADD COLUMN "rangeStart" TEXT;
ALTER TABLE "IpBlock" ADD COLUMN "rangeEnd" TEXT;

-- IP 区间分配
ALTER TABLE "ResourceAllocation" ADD COLUMN "ipRangeStart" TEXT;
ALTER TABLE "ResourceAllocation" ADD COLUMN "ipRangeEnd" TEXT;
CREATE INDEX "ResourceAllocation_resourceType_ipBlockId_releasedAt_idx"
  ON "ResourceAllocation"("resourceType", "ipBlockId", "releasedAt");
