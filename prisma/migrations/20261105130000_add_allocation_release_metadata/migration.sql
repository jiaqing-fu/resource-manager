-- 整条释放的分配记录直接保存释放备注、操作人与批次；
-- IP/机柜的部分释放仍记录在各自明细表上。
ALTER TABLE "ResourceAllocation" ADD COLUMN "releaseNote" TEXT;
ALTER TABLE "ResourceAllocation" ADD COLUMN "releasedByName" TEXT;
ALTER TABLE "ResourceAllocation" ADD COLUMN "releaseBatchId" TEXT;

CREATE INDEX "ResourceAllocation_releaseBatchId_idx"
  ON "ResourceAllocation"("releaseBatchId");
