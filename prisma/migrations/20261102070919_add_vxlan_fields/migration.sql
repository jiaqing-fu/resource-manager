-- AlterTable
ALTER TABLE "Vlan" ADD COLUMN "vxlanDescription" TEXT;
ALTER TABLE "Vlan" ADD COLUMN "vxlanName" TEXT;
ALTER TABLE "Vlan" ADD COLUMN "vxlanStatus" TEXT;
ALTER TABLE "Vlan" ADD COLUMN "vxlanVni" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Vlan_vxlanVni_key" ON "Vlan"("vxlanVni");
