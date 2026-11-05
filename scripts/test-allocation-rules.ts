import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { ApiError } from "../src/lib/api";
import {
  assertRackAllocationsDisjoint,
  createAllocation,
  listAvailableResources,
  loadRackAllocationCounts,
  releaseAllocation,
  releaseAllocations,
  saveBatchAllocations,
} from "../src/server/services/allocations";
import {
  validateDevicePlacement,
  validateRackSegment,
} from "../src/server/services/inventory";
import { syncRangeAddresses, validateBlockInput } from "../src/server/services/ipam";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl.includes("business-test.db")) {
  console.error(
    "拒绝执行：请将 DATABASE_URL 指向隔离的 data/business-test.db（当前值不匹配）。",
  );
  process.exit(1);
}

type Tx = Prisma.TransactionClient;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function expectCode(code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError && error.code === code) return;
    throw error;
  }
  throw new Error(`预期错误 ${code}，但操作成功`);
}

async function createRack(tx: Tx, code: string, uStart: number, uEnd: number) {
  await validateRackSegment(tx, { code, uStart, uEnd });
  return tx.rack.create({ data: { code, uStart, uEnd } });
}

async function createDevice(
  tx: Tx,
  input: { name: string; rackId: string; uStart: number; uHeight: number; face: string },
) {
  const placement = await validateDevicePlacement(tx, input);
  return tx.device.create({
    data: {
      name: input.name,
      rackId: placement.rackId,
      uStart: placement.uStart,
      uHeight: placement.uHeight,
      face: placement.face,
    },
  });
}

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.changeLog.deleteMany();
    await tx.rackAllocationItem.deleteMany();
    await tx.resourceAllocationItem.deleteMany();
    await tx.resourceAllocation.deleteMany();
    await tx.businessSystemEndpoint.deleteMany();
    await tx.businessSystem.deleteMany();
    await tx.broadband.deleteMany();
    await tx.customerTest.deleteMany();
    await tx.lineTermination.deleteMany();
    await tx.line.deleteMany();
    await tx.ipAddress.deleteMany();
    await tx.device.deleteMany();
    await tx.ipBlock.updateMany({ data: { parentId: null } });
    await tx.ipBlock.deleteMany();
    await tx.vxlan.deleteMany();
    await tx.vlan.deleteMany();
    await tx.rack.deleteMany();
    await tx.supplierContact.deleteMany();
    await tx.supplier.updateMany({ data: { parentId: null } });
    await tx.supplier.deleteMany();
    await tx.customer.deleteMany();
  });

  const supplier = await prisma.supplier.create({
    data: { name: "测试供应商", level: 1 },
  });
  const [customerA, customerB, batchA, batchB] = await Promise.all([
    prisma.customer.create({ data: { name: "测试客户A", level: 1 } }),
    prisma.customer.create({ data: { name: "测试客户B", level: 1 } }),
    prisma.customer.create({ data: { name: "批量客户甲", level: 1 } }),
    prisma.customer.create({ data: { name: "批量客户乙", level: 1 } }),
  ]);

  // 1. 机柜编号相同、区间不重叠可以共存；重叠被拒绝。
  const racks = await prisma.$transaction(async (tx) => {
    const a10Low = await createRack(tx, "A10", 1, 2);
    await expectCode("RACK_RANGE_OVERLAP", () => createRack(tx, "A10", 2, 3));
    const a10High = await createRack(tx, "A10", 3, 4);
    return { a10Low, a10High };
  });
  console.log("PASS 机柜同编号多区间与重叠校验");

  // 2. 设备同面互斥、前后可共用、超出区间拒绝。
  await prisma.$transaction(async (tx) => {
    await createDevice(tx, {
      name: "前面板设备1",
      rackId: racks.a10Low.id,
      uStart: 1,
      uHeight: 2,
      face: "front",
    });
    await expectCode("U_CONFLICT", () =>
      createDevice(tx, {
        name: "前面板设备2",
        rackId: racks.a10Low.id,
        uStart: 2,
        uHeight: 1,
        face: "front",
      }),
    );
    await createDevice(tx, {
      name: "后面板设备1",
      rackId: racks.a10Low.id,
      uStart: 1,
      uHeight: 2,
      face: "rear",
    });
    await expectCode("U_OUT_OF_RANGE", () =>
      createDevice(tx, {
        name: "越界设备",
        rackId: racks.a10Low.id,
        uStart: 2,
        uHeight: 2,
        face: "rear",
      }),
    );
  });
  console.log("PASS 设备同面互斥、前后共用与区间校验");

  // 3. 资源分配与设备区间可以重叠；分配之间互斥。
  const rangeRack = await prisma.$transaction(async (tx) => {
    const rack = await createRack(tx, "A11", 1, 4);
    await createDevice(tx, {
      name: "占用1-2U的设备",
      rackId: rack.id,
      uStart: 1,
      uHeight: 2,
      face: "front",
    });
    await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "rack",
      resourceId: rack.id,
      uStart: 1,
      uEnd: 2,
      allocatedAt: "2026-11-01",
    });
    await expectCode("RACK_RANGE_OVERLAP", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "rack",
        resourceId: rack.id,
        uStart: 2,
        uEnd: 3,
        allocatedAt: "2026-11-01",
      }),
    );
    await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "rack",
      resourceId: rack.id,
      uStart: 3,
      uEnd: 4,
      allocatedAt: "2026-11-01",
    });
    await assertRackAllocationsDisjoint(tx, rack.id);
    return rack;
  });
  console.log("PASS 资源分配可与设备重叠、分配区间互斥");

  // 4. 宽带允许超分，复用率按有效分配求和。
  const broadband = await prisma.broadband.create({
    data: { name: "BW-TEST-100", bandwidthMbps: 100 },
  });
  await prisma.$transaction(async (tx) => {
    await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "broadband",
      resourceId: broadband.id,
      allocatedMbps: 50,
      allocatedAt: "2026-11-01",
    });
    await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "broadband",
      resourceId: broadband.id,
      allocatedMbps: 100,
      allocatedAt: "2026-11-01",
    });
    const sum = await tx.resourceAllocation.aggregate({
      where: { broadbandId: broadband.id, releasedAt: null },
      _sum: { allocatedMbps: true },
    });
    assert(sum._sum.allocatedMbps === 150, "有效分配应为 150 Mbps");
  });
  console.log("PASS 宽带超分与复用率求和");

  // 5. 缓存重算：单客户回填，多客户清空，释放后恢复。
  const cacheRack = await prisma.rack.create({
    data: { code: "CACHE", uStart: 1, uEnd: 4 },
  });
  await prisma.$transaction(async (tx) => {
    const first = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "rack",
      resourceId: cacheRack.id,
      uStart: 1,
      uEnd: 1,
      allocatedAt: "2026-11-01",
    });
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: cacheRack.id } })).customerId ===
        customerA.id,
      "单客户应回填缓存",
    );
    const second = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "rack",
      resourceId: cacheRack.id,
      uStart: 2,
      uEnd: 2,
      allocatedAt: "2026-11-01",
    });
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: cacheRack.id } })).customerId === null,
      "多客户应清空缓存",
    );
    await releaseAllocation(tx, second.allocation.id, "2026-11-03");
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: cacheRack.id } })).customerId ===
        customerA.id,
      "释放后应恢复单客户缓存",
    );
    await releaseAllocation(tx, first.allocation.id, "2026-11-03");
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: cacheRack.id } })).customerId === null,
      "全部释放后应清空缓存",
    );
  });
  console.log("PASS 机柜客户缓存重算");

  // 6. 多客户、8 类资源批量保存。
  const batchResources = await prisma.$transaction(async (tx) => {
    const [rackA, rackB] = await Promise.all([
      createRack(tx, "BATCH-A", 1, 4),
      createRack(tx, "BATCH-B", 1, 4),
    ]);
    const [blockA, blockB] = await Promise.all([
      tx.ipBlock.create({ data: { cidr: "10.20.0.0/24", ipVersion: 4 } }),
      tx.ipBlock.create({ data: { cidr: "10.21.0.0/24", ipVersion: 4 } }),
    ]);
    const [ipA, ipB] = await Promise.all([
      tx.ipAddress.create({ data: { address: "10.20.0.10" } }),
      tx.ipAddress.create({ data: { address: "10.21.0.10" } }),
    ]);
    const [vlanA, vlanB] = await Promise.all([
      tx.vlan.create({ data: { vid: 200, name: "BATCH-A" } }),
      tx.vlan.create({ data: { vid: 201, name: "BATCH-B" } }),
    ]);
    const [vxlanA, vxlanB] = await Promise.all([
      tx.vxlan.create({ data: { vni: 20000 } }),
      tx.vxlan.create({ data: { vni: 20001 } }),
    ]);
    const [bandwidthA, bandwidthB] = await Promise.all([
      tx.broadband.create({ data: { name: "BW-BATCH-A", bandwidthMbps: 1000 } }),
      tx.broadband.create({ data: { name: "BW-BATCH-B", bandwidthMbps: 1000 } }),
    ]);
    const [deviceA, deviceB] = await Promise.all([
      tx.device.create({ data: { name: "BATCH-DEV-A" } }),
      tx.device.create({ data: { name: "BATCH-DEV-B" } }),
    ]);
    const [lineA, lineB] = await Promise.all([
      tx.line.create({ data: { code: "BATCH-LINE-A", name: "批量线路A" } }),
      tx.line.create({ data: { code: "BATCH-LINE-B", name: "批量线路B" } }),
    ]);
    return {
      rackA, rackB, blockA, blockB, ipA, ipB, vlanA, vlanB,
      vxlanA, vxlanB, bandwidthA, bandwidthB, deviceA, deviceB, lineA, lineB,
    };
  });

  const batchResult = await prisma.$transaction((tx) =>
    saveBatchAllocations(tx, {
      allocatedAt: "2026-11-02",
      notes: "规则测试",
      groups: [
        {
          customerId: batchA.id,
          releases: [],
          creates: [
            { resourceType: "ipAddress", resourceId: batchResources.ipA.id },
            { resourceType: "ipBlock", resourceId: batchResources.blockA.id },
            {
              resourceType: "ipRange",
              resourceId: batchResources.blockA.id,
              ipRangeStart: "10.20.0.0",
              ipRangeEnd: "10.20.0.3",
            },
            {
              resourceType: "rack",
              resourceId: batchResources.rackA.id,
              uStart: 1,
              uEnd: 1,
            },
            { resourceType: "device", resourceId: batchResources.deviceA.id },
            { resourceType: "vlan", resourceId: batchResources.vlanA.id },
            { resourceType: "vxlan", resourceId: batchResources.vxlanA.id },
            {
              resourceType: "broadband",
              resourceId: batchResources.bandwidthA.id,
              allocatedMbps: 1200,
            },
            { resourceType: "line", resourceId: batchResources.lineA.id },
          ],
        },
        {
          customerId: batchB.id,
          releases: [],
          creates: [
            { resourceType: "ipAddress", resourceId: batchResources.ipB.id },
            { resourceType: "ipBlock", resourceId: batchResources.blockB.id },
            {
              resourceType: "ipRange",
              resourceId: batchResources.blockB.id,
              ipRangeStart: "10.21.0.0",
              ipRangeEnd: "10.21.0.3",
            },
            {
              resourceType: "rack",
              resourceId: batchResources.rackB.id,
              uStart: 1,
              uEnd: 1,
            },
            { resourceType: "device", resourceId: batchResources.deviceB.id },
            { resourceType: "vlan", resourceId: batchResources.vlanB.id },
            { resourceType: "vxlan", resourceId: batchResources.vxlanB.id },
            {
              resourceType: "broadband",
              resourceId: batchResources.bandwidthB.id,
              allocatedMbps: 800,
            },
            { resourceType: "line", resourceId: batchResources.lineB.id },
          ],
        },
      ],
    }),
  );
  assert(batchResult.created === 18, "批量应新增 18 条");
  assert(batchResult.released === 0, "批量不应释放");
  const createdKeys = await prisma.resourceAllocation.findMany({
    where: { id: { in: batchResult.creates.map((row) => row.id) } },
    select: {
      resourceType: true,
      activeKey: true,
      uStart: true,
      ipRangeStart: true,
      ipRangeEnd: true,
      allocatedMbps: true,
    },
  });
  for (const row of createdKeys) {
    if (
      row.resourceType === "rack" ||
      row.resourceType === "broadband" ||
      row.resourceType === "ipRange"
    ) {
      assert(row.activeKey === null, "机柜/宽带/IP 区间 activeKey 应为 NULL");
    } else {
      assert(row.activeKey !== null, "单一资源 activeKey 不应为 NULL");
    }
  }
  console.log("PASS 多客户 9 类资源批量保存");

  // 7. 同一批次先释放、再复用同一机柜区间。
  const rackAllocation = batchResult.creates.find((row) => row.resourceType === "rack")!;
  const reuseResult = await prisma.$transaction((tx) =>
    saveBatchAllocations(tx, {
      allocatedAt: "2026-11-03",
      releasedAt: "2026-11-03",
      groups: [
        {
          customerId: batchA.id,
          releases: [rackAllocation.id],
          creates: [
            {
              resourceType: "rack",
              resourceId: batchResources.rackA.id,
              uStart: 1,
              uEnd: 1,
            },
          ],
        },
      ],
    }),
  );
  assert(reuseResult.released === 1 && reuseResult.created === 1, "释放后应可复用");
  const activeRackRows = await prisma.resourceAllocation.count({
    where: { rackId: batchResources.rackA.id, releasedAt: null, uStart: 1, uEnd: 1 },
  });
  assert(activeRackRows === 1, "复用后同一区间应只有一条有效分配");
  console.log("PASS 同一事务释放并复用机柜区间");

  // 8. 跨客户机柜区间重叠导致整批回滚。
  const overlapRack = await prisma.rack.create({
    data: { code: "BATCH-OVERLAP", uStart: 1, uEnd: 4 },
  });
  await expectCode("RACK_RANGE_OVERLAP", () =>
    prisma.$transaction((tx) =>
      saveBatchAllocations(tx, {
        allocatedAt: "2026-11-02",
        groups: [
          {
            customerId: customerA.id,
            releases: [],
            creates: [
              { resourceType: "rack", resourceId: overlapRack.id, uStart: 1, uEnd: 2 },
            ],
          },
          {
            customerId: customerB.id,
            releases: [],
            creates: [
              { resourceType: "rack", resourceId: overlapRack.id, uStart: 2, uEnd: 3 },
            ],
          },
        ],
      }),
    ),
  );
  assert(
    (await prisma.resourceAllocation.count({ where: { rackId: overlapRack.id } })) === 0,
    "冲突批次应全部回滚",
  );
  console.log("PASS 跨客户机柜区间冲突整批回滚");

  // 9. 任一非法项导致整批回滚。
  const rollbackIp = await prisma.ipAddress.create({
    data: { address: "10.30.0.10" },
  });
  await expectCode("RESOURCE_NOT_FOUND", () =>
    prisma.$transaction((tx) =>
      saveBatchAllocations(tx, {
        allocatedAt: "2026-11-02",
        groups: [
          {
            customerId: customerA.id,
            releases: [],
            creates: [
              { resourceType: "ipAddress", resourceId: rollbackIp.id },
              { resourceType: "line", resourceId: "missing-line-id" },
            ],
          },
        ],
      }),
    ),
  );
  assert(
    (await prisma.resourceAllocation.count({ where: { ipAddressId: rollbackIp.id } })) === 0,
    "非法项之前的有效项也应回滚",
  );
  console.log("PASS 批量非法项整批回滚");

  // 10. 释放日期早于分配日期被拒绝。
  const dateRack = await prisma.rack.create({
    data: { code: "BATCH-DATE", uStart: 1, uEnd: 2 },
  });
  const dated = await prisma.$transaction((tx) =>
    createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "rack",
      resourceId: dateRack.id,
      uStart: 1,
      uEnd: 1,
      allocatedAt: "2026-11-02",
    }),
  );
  await expectCode("RELEASE_BEFORE_ALLOCATED", () =>
    prisma.$transaction((tx) =>
      saveBatchAllocations(tx, {
        releasedAt: "2026-11-01",
        groups: [{ customerId: customerA.id, releases: [dated.allocation.id], creates: [] }],
      }),
    ),
  );
  assert(
    (await prisma.resourceAllocation.findUniqueOrThrow({
      where: { id: dated.allocation.id },
    })).releasedAt === null,
    "释放失败时分配应保持有效",
  );
  console.log("PASS 释放日期早于分配日期被拒绝");

  // 11. 同一批重复客户被拒绝。
  await prisma.$transaction(async (tx) => {
    await expectCode("DUPLICATE_CUSTOMER", () =>
      saveBatchAllocations(tx, {
        groups: [
          { customerId: customerA.id, releases: [], creates: [] },
          { customerId: customerA.id, releases: [], creates: [] },
        ],
      }),
    );
  });
  console.log("PASS 重复客户校验");

  // 12. 宽带缓存重算。
  const cacheBroadband = await prisma.broadband.create({
    data: { name: "BW-CACHE", bandwidthMbps: 100 },
  });
  await prisma.$transaction(async (tx) => {
    await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "broadband",
      resourceId: cacheBroadband.id,
      allocatedMbps: 50,
      allocatedAt: "2026-11-01",
    });
    assert(
      (await tx.broadband.findUniqueOrThrow({ where: { id: cacheBroadband.id } })).customerId ===
        customerA.id,
      "单客户宽带应回填缓存",
    );
    const second = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "broadband",
      resourceId: cacheBroadband.id,
      allocatedMbps: 100,
      allocatedAt: "2026-11-01",
    });
    assert(
      (await tx.broadband.findUniqueOrThrow({ where: { id: cacheBroadband.id } })).customerId ===
        null,
      "多客户宽带应清空缓存",
    );
    await releaseAllocation(tx, second.allocation.id, "2026-11-03");
    assert(
      (await tx.broadband.findUniqueOrThrow({ where: { id: cacheBroadband.id } })).customerId ===
        customerA.id,
      "释放后宽带应恢复单客户缓存",
    );
  });
  console.log("PASS 宽带客户缓存重算");

  // 13. IP 区间：自动生成地址、区间/单 IP 互斥、释放后客户缓存清理。
  const rangeBlock = await prisma.$transaction(async (tx) => {
    const validated = await validateBlockInput(tx, {
      cidr: "10.40.0.0-10.40.0.15",
      status: "active",
      role: "other",
      supplierId: supplier.id,
    });
    const block = await tx.ipBlock.create({
      data: {
        cidr: validated.cidr,
        kind: validated.kind,
        rangeStart: validated.rangeStart,
        rangeEnd: validated.rangeEnd,
        ipVersion: validated.ipVersion,
        status: "active",
        role: "other",
        supplierId: supplier.id,
      },
    });
    const ref = {
      id: block.id,
      cidr: validated.cidr,
      kind: validated.kind,
      rangeStart: validated.rangeStart,
      rangeEnd: validated.rangeEnd,
      ipVersion: validated.ipVersion,
      supplierId: supplier.id,
    };
    const generated = await syncRangeAddresses(tx, ref);
    assert(generated.created === 16, "区间应自动生成 16 个地址");
    assert(
      (await tx.ipAddress.count({ where: { blockId: block.id } })) === 16,
      "区间内地址数应为 16",
    );
    const again = await syncRangeAddresses(tx, ref);
    assert(
      again.created === 0 && again.reused === 16,
      "区间地址同步应幂等，不重复创建",
    );
    return block;
  });
  console.log("PASS IP 区间自动生成地址与幂等同步");

  await prisma.$transaction(async (tx) => {
    const rangeAllocation = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "ipRange",
      resourceId: rangeBlock.id,
      ipRangeStart: "10.40.0.4",
      ipRangeEnd: "10.40.0.7",
      allocatedAt: "2026-11-01",
    });
    const inherited = await tx.ipAddress.findMany({
      where: { blockId: rangeBlock.id, customerId: customerA.id },
      select: { address: true },
      orderBy: { address: "asc" },
    });
    assert(inherited.length === 4, "区间分配应把 4 个地址写入客户缓存");
    assert(
      (await tx.ipBlock.findUniqueOrThrow({ where: { id: rangeBlock.id } })).customerId === null,
      "区间分配不应写 IpBlock.customerId 缓存",
    );
    await expectCode("IP_RANGE_OVERLAP", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "ipRange",
        resourceId: rangeBlock.id,
        ipRangeStart: "10.40.0.6",
        ipRangeEnd: "10.40.0.9",
        allocatedAt: "2026-11-01",
      }),
    );
    await expectCode("IP_RANGE_OUTSIDE_BLOCK", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "ipRange",
        resourceId: rangeBlock.id,
        ipRangeStart: "10.40.0.0",
        ipRangeEnd: "10.40.0.16",
        allocatedAt: "2026-11-01",
      }),
    );
    await expectCode("IP_RANGE_TOO_LARGE", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "ipRange",
        resourceId: rangeBlock.id,
        ipRangeStart: "10.40.0.0",
        ipRangeEnd: "10.40.16.0",
        allocatedAt: "2026-11-01",
      }),
    );
    const singleIp = await tx.ipAddress.findFirstOrThrow({
      where: { blockId: rangeBlock.id, address: "10.40.0.12" },
    });
    const coveredIp = await tx.ipAddress.findFirstOrThrow({
      where: { blockId: rangeBlock.id, address: "10.40.0.5" },
    });
    const single = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "ipAddress",
      resourceId: singleIp.id,
      allocatedAt: "2026-11-01",
    });
    await expectCode("IP_IN_ALLOCATED_RANGE", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "ipAddress",
        resourceId: coveredIp.id,
        allocatedAt: "2026-11-01",
      }),
    );
    await expectCode("IP_RANGE_HAS_ALLOCATED_ADDRESS", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "ipRange",
        resourceId: rangeBlock.id,
        ipRangeStart: "10.40.0.10",
        ipRangeEnd: "10.40.0.13",
        allocatedAt: "2026-11-01",
      }),
    );
    await releaseAllocation(tx, single.allocation.id, "2026-11-03");
    await releaseAllocation(tx, rangeAllocation.allocation.id, "2026-11-03");
    assert(
      (await tx.ipAddress.count({
        where: { blockId: rangeBlock.id, customerId: { not: null } },
      })) === 0,
      "释放区间分配后地址客户缓存应清空",
    );
  });
  console.log("PASS IP 区间分配互斥、单 IP 反向校验与释放清理");

  // 14. 任意 IP 集合分配、奇数 IP 批量释放、释放记录与再分配。
  const oddBlock = await prisma.$transaction(async (tx) => {
    const validated = await validateBlockInput(tx, {
      cidr: "10.41.0.0-10.41.0.63",
      status: "active",
      role: "other",
      supplierId: supplier.id,
    });
    const block = await tx.ipBlock.create({
      data: {
        cidr: validated.cidr,
        kind: validated.kind,
        rangeStart: validated.rangeStart,
        rangeEnd: validated.rangeEnd,
        ipVersion: validated.ipVersion,
        status: "active",
        role: "other",
        supplierId: supplier.id,
      },
    });
    await syncRangeAddresses(tx, {
      id: block.id,
      cidr: validated.cidr,
      kind: validated.kind,
      rangeStart: validated.rangeStart,
      rangeEnd: validated.rangeEnd,
      ipVersion: validated.ipVersion,
      supplierId: supplier.id,
    });
    return block;
  });

  await prisma.$transaction(async (tx) => {
    const setAllocation = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "ipRange",
      resourceId: oddBlock.id,
      ipList: "10.41.0.0, 10.41.0.2, 10.41.0.4-10.41.0.6",
      allocatedAt: "2026-11-01",
    });
    assert(
      setAllocation.allocation.ipRangeStart === "10.41.0.0" &&
        setAllocation.allocation.ipRangeEnd === "10.41.0.6",
      "非连续集合应记录最小/最大地址",
    );
    const items = await tx.resourceAllocationItem.findMany({
      where: { allocationId: setAllocation.allocation.id },
      orderBy: { address: "asc" },
    });
    assert(items.length === 5, "非连续集合应生成 5 条明细");
    assert(
      (await tx.resourceAllocation.count({
        where: {
          resourceType: "ipRange",
          items: { some: { address: "10.41.0.5" } },
        },
      })) === 1,
      "按区间内 IP 应能反查分配记录",
    );

    const partial = await releaseAllocation(tx, setAllocation.allocation.id, {
      ipList: "10.41.0.0,10.41.0.2",
      releasedAt: "2026-11-03",
      releaseNote: "释放偶数位前的两个 IP",
      releasedByName: "测试员",
    });
    assert(
      partial.releasedCount === 2 &&
        partial.remainingCount === 3 &&
        !partial.parentReleased,
      "部分释放应保留父分配和 3 个有效 IP",
    );
    const releasedItems = await tx.resourceAllocationItem.findMany({
      where: {
        allocationId: setAllocation.allocation.id,
        releasedAt: { not: null },
      },
      select: { releaseBatchId: true, releasedByName: true, releaseNote: true },
    });
    assert(releasedItems.length === 2, "应产生 2 条释放记录");
    assert(
      new Set(releasedItems.map((item) => item.releaseBatchId)).size === 1,
      "同一次部分释放应共用一个批次号",
    );
    assert(
      releasedItems.every(
        (item) =>
          item.releasedByName === "测试员" &&
          item.releaseNote === "释放偶数位前的两个 IP",
      ),
      "释放记录应保存操作人与备注",
    );

    const availableBlocks = await listAvailableResources(tx, "ipRange");
    const availableBlock = availableBlocks.find(
      (row) => row.blockId === oddBlock.id,
    );
    assert(
      availableBlock?.freeIpRanges?.some(
        (range) =>
          range.startIp === "10.41.0.0" && range.endIp === "10.41.0.3",
      ),
      "部分释放后空闲区间应从已释放 IP 重新计算",
    );
    const availableIps = await listAvailableResources(
      tx,
      "ipAddress",
      "10.41.0.",
    );
    assert(
      availableIps.some((row) => row.name === "10.41.0.0"),
      "已释放 IP 应重新出现在单 IP 可选列表",
    );
    assert(
      !availableIps.some((row) => row.name === "10.41.0.4"),
      "有效明细中的 IP 不应出现在单 IP 可选列表",
    );

    await expectCode("IP_NOT_IN_ALLOCATION", () =>
      releaseAllocation(tx, setAllocation.allocation.id, {
        ipList: "10.41.0.7",
        releasedAt: "2026-11-03",
      }),
    );
    await expectCode("IP_ALREADY_RELEASED", () =>
      releaseAllocation(tx, setAllocation.allocation.id, {
        ipList: "10.41.0.0",
        releasedAt: "2026-11-03",
      }),
    );

    // 已释放的 .0 可以重新做单 IP 分配，并再次占用。
    const releasedIp = await tx.ipAddress.findFirstOrThrow({
      where: { blockId: oddBlock.id, address: "10.41.0.0" },
    });
    const singleAgain = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "ipAddress",
      resourceId: releasedIp.id,
      allocatedAt: "2026-11-03",
    });
    await expectCode("IP_RANGE_HAS_ALLOCATED_ADDRESS", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "ipRange",
        resourceId: oddBlock.id,
        ipList: "10.41.0.0-10.41.0.1",
        allocatedAt: "2026-11-03",
      }),
    );
    await releaseAllocation(tx, singleAgain.allocation.id, "2026-11-04");

    const rest = await releaseAllocation(tx, setAllocation.allocation.id, {
      ipList: "10.41.0.4-10.41.0.6",
      releasedAt: "2026-11-04",
    });
    assert(
      rest.releasedCount === 3 &&
        rest.remainingCount === 0 &&
        rest.parentReleased,
      "释放全部剩余 IP 后父分配应自动释放",
    );
    assert(
      (await tx.resourceAllocation.findUniqueOrThrow({
        where: { id: setAllocation.allocation.id },
      })).releasedAt !== null,
      "父分配应写入释放时间",
    );
    assert(
      (await tx.ipAddress.count({
        where: { blockId: oddBlock.id, customerId: { not: null } },
      })) === 0,
      "全部释放后地址客户缓存应清空",
    );
  });
  console.log("PASS 任意 IP 集合分配、部分释放、释放记录与再分配");

  // 15. 机柜任意 U 集合分配、部分释放、可用区间与再分配。
  const uListRack = await prisma.rack.create({
    data: { code: "RACK-ULIST", uStart: 1, uEnd: 12 },
  });
  await prisma.$transaction(async (tx) => {
    const freeText = (ranges?: Array<{ start: number; end: number }>) =>
      (ranges ?? []).map((range) => `${range.start}-${range.end}`).join(",");

    const setAllocation = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "rack",
      resourceId: uListRack.id,
      uList: "1, 3, 5-6",
      allocatedAt: "2026-11-01",
    });
    assert(
      setAllocation.allocation.uStart === 1 &&
        setAllocation.allocation.uEnd === 6,
      "非连续 U 集合应记录最小/最大 U 位",
    );
    const items = await tx.rackAllocationItem.findMany({
      where: { allocationId: setAllocation.allocation.id },
      orderBy: { uNumber: "asc" },
    });
    assert(
      items.map((item) => item.uNumber).join(",") === "1,3,5,6",
      "非连续 U 集合应生成 1,3,5,6 四条明细",
    );
    const beforeCounts = await loadRackAllocationCounts(tx, [
      setAllocation.allocation.id,
    ]);
    assert(
      beforeCounts.get(setAllocation.allocation.id)?.total === 4 &&
        beforeCounts.get(setAllocation.allocation.id)?.active === 4,
      "列表统计应显示 4 个 U 位",
    );

    await expectCode("RACK_RANGE_OVERLAP", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "rack",
        resourceId: uListRack.id,
        uList: "6-7",
        allocatedAt: "2026-11-01",
      }),
    );
    await expectCode("RACK_RANGE_OVERLAP", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "rack",
        resourceId: uListRack.id,
        uStart: 2,
        uEnd: 3,
        allocatedAt: "2026-11-01",
      }),
    );
    await expectCode("RACK_RANGE_OUT_OF_BOUNDS", () =>
      createAllocation(tx, {
        customerId: customerB.id,
        resourceType: "rack",
        resourceId: uListRack.id,
        uList: "12-13",
        allocatedAt: "2026-11-01",
      }),
    );

    const availableBefore = (
      await listAvailableResources(tx, "rack", "RACK-ULIST")
    ).find((row) => row.id === uListRack.id);
    assert(availableBefore, "应能查询到机柜可用情况");
    assert(
      freeText(availableBefore.freeRanges) === "2-2,4-4,7-12",
      `非连续占用后空闲区间应为 2,4,7-12，实际 ${freeText(availableBefore.freeRanges)}`,
    );

    const partial = await releaseAllocation(tx, setAllocation.allocation.id, {
      uList: "1,5",
      releasedAt: "2026-11-03",
      releaseNote: "释放 U1 与 U5",
      releasedByName: "测试员",
    });
    assert(
      partial.releasedCount === 2 &&
        partial.remainingCount === 2 &&
        !partial.parentReleased,
      "部分释放应保留父分配和 2 个有效 U 位",
    );
    const releasedItems = await tx.rackAllocationItem.findMany({
      where: {
        allocationId: setAllocation.allocation.id,
        releasedAt: { not: null },
      },
      select: {
        releaseBatchId: true,
        releasedByName: true,
        releaseNote: true,
      },
    });
    assert(releasedItems.length === 2, "应产生 2 条 U 位释放记录");
    assert(
      releasedItems.every(
        (item) =>
          item.releaseBatchId === partial.releaseBatchId &&
          item.releasedByName === "测试员" &&
          item.releaseNote === "释放 U1 与 U5",
      ),
      "同一次部分释放应共用批次号并保存操作人与备注",
    );

    const availableAfter = (
      await listAvailableResources(tx, "rack", "RACK-ULIST")
    ).find((row) => row.id === uListRack.id);
    assert(availableAfter, "部分释放后应能查询到机柜可用情况");
    assert(
      freeText(availableAfter.freeRanges) === "1-2,4-5,7-12",
      `部分释放后空闲区间应由有效明细重新计算，实际 ${freeText(availableAfter.freeRanges)}`,
    );
    const afterCounts = await loadRackAllocationCounts(tx, [
      setAllocation.allocation.id,
    ]);
    assert(
      afterCounts.get(setAllocation.allocation.id)?.active === 2,
      "部分释放后列表统计应剩余 2 个 U 位",
    );

    await expectCode("UNIT_NOT_IN_ALLOCATION", () =>
      releaseAllocation(tx, setAllocation.allocation.id, {
        uList: "7",
        releasedAt: "2026-11-04",
      }),
    );
    await expectCode("UNIT_ALREADY_RELEASED", () =>
      releaseAllocation(tx, setAllocation.allocation.id, {
        uList: "1",
        releasedAt: "2026-11-04",
      }),
    );

    // 已释放的 U1 可重新分配给其他客户。
    const realloc = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "rack",
      resourceId: uListRack.id,
      uList: "1",
      allocatedAt: "2026-11-03",
    });
    const rest = await releaseAllocation(tx, setAllocation.allocation.id, {
      uList: "3,6",
      releasedAt: "2026-11-04",
    });
    assert(
      rest.releasedCount === 2 &&
        rest.remainingCount === 0 &&
        rest.parentReleased,
      "释放全部剩余 U 位后父分配应自动释放",
    );
    const releasedParent = await tx.resourceAllocation.findUniqueOrThrow({
      where: { id: setAllocation.allocation.id },
    });
    assert(releasedParent.releasedAt !== null, "父分配应写入释放时间");
    assert(
      releasedParent.releaseBatchId === rest.releaseBatchId,
      "整条释放后父分配应保存最后一次释放批次",
    );
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: uListRack.id } }))
        .customerId === customerB.id,
      "仅剩一个客户的有效分配时应回填客户缓存",
    );

    const releasedWhole = await releaseAllocation(tx, realloc.allocation.id, {
      releasedAt: "2026-11-05",
    });
    assert(
      releasedWhole.releasedCount === 1 && releasedWhole.parentReleased,
      "整条释放应释放剩余 U 位",
    );
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: uListRack.id } }))
        .customerId === null,
      "全部释放后机柜客户缓存应清空",
    );
  });
  console.log("PASS 机柜任意 U 集合分配、部分释放、可用区间与再分配");

  // 16. 批量释放多条分配共用批次号，且校验失败不留下半释放状态。
  const batchReleaseRack = await prisma.rack.create({
    data: { code: "RACK-BATCH-REL", uStart: 1, uEnd: 8 },
  });
  await prisma.$transaction(async (tx) => {
    const first = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "rack",
      resourceId: batchReleaseRack.id,
      uList: "1-2",
      allocatedAt: "2026-11-01",
    });
    const second = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "rack",
      resourceId: batchReleaseRack.id,
      uList: "3-4",
      allocatedAt: "2026-11-01",
    });
    const third = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "rack",
      resourceId: batchReleaseRack.id,
      uList: "5",
      allocatedAt: "2026-11-01",
    });

    const batch = await releaseAllocations(tx, {
      ids: [first.allocation.id, second.allocation.id],
      releasedAt: "2026-11-05",
      releaseNote: "批量释放整条分配",
      releasedByName: "批量操作员",
    });
    assert(
      batch.released === 2 && batch.totalUnits === 4,
      "应批量释放 2 条共 4 个 U 位",
    );
    const firstParent = await tx.resourceAllocation.findUniqueOrThrow({
      where: { id: first.allocation.id },
    });
    assert(
      firstParent.releaseNote === "批量释放整条分配" &&
        firstParent.releasedByName === "批量操作员" &&
        firstParent.releaseBatchId === batch.releaseBatchId,
      "整条释放的父分配应保存备注、操作人与批次",
    );
    const batchItems = await tx.rackAllocationItem.findMany({
      where: {
        allocationId: { in: [first.allocation.id, second.allocation.id] },
        releasedAt: { not: null },
      },
      select: {
        releaseBatchId: true,
        releaseNote: true,
        releasedByName: true,
      },
    });
    assert(
      batchItems.length === 4 &&
        batchItems.every(
          (item) =>
            item.releaseBatchId === batch.releaseBatchId &&
            item.releaseNote === "批量释放整条分配" &&
            item.releasedByName === "批量操作员",
        ),
      "批量释放应共用批次号并保存备注与操作人",
    );

    await expectCode("ALREADY_RELEASED", () =>
      releaseAllocations(tx, {
        ids: [first.allocation.id, third.allocation.id],
        releasedAt: "2026-11-05",
      }),
    );
    assert(
      (await tx.resourceAllocation.findUniqueOrThrow({
        where: { id: third.allocation.id },
      })).releasedAt === null,
      "批量释放校验失败时不应留下部分释放",
    );

    const single = await releaseAllocations(tx, {
      ids: [third.allocation.id],
      releasedAt: "2026-11-05",
    });
    assert(
      single.released === 1 && single.totalUnits === 1,
      "单条批量释放应释放剩余 U 位",
    );
    assert(
      (await tx.rack.findUniqueOrThrow({ where: { id: batchReleaseRack.id } }))
        .customerId === null,
      "批量释放后机柜客户缓存应清空",
    );
  });
  console.log("PASS 批量释放多条分配共用批次号与失败回滚");

  // 17. 非区间资源整条释放保存备注/操作人/批次（含单个释放）。
  const noteVlan = await prisma.vlan.create({
    data: { vid: 300, name: "NOTE-VLAN" },
  });
  const noteIp = await prisma.ipAddress.create({
    data: { address: "10.50.0.10" },
  });
  await prisma.$transaction(async (tx) => {
    const vlanAllocation = await createAllocation(tx, {
      customerId: customerA.id,
      resourceType: "vlan",
      resourceId: noteVlan.id,
      allocatedAt: "2026-11-01",
    });
    const batch = await releaseAllocations(tx, {
      ids: [vlanAllocation.allocation.id],
      releasedAt: "2026-11-05",
      releaseNote: "整条释放备注",
      releasedByName: "备注测试员",
    });
    assert(batch.releaseBatchId !== null, "整条释放也应生成批次号");
    const vlanRow = await tx.resourceAllocation.findUniqueOrThrow({
      where: { id: vlanAllocation.allocation.id },
    });
    assert(
      vlanRow.releasedAt !== null &&
        vlanRow.releaseNote === "整条释放备注" &&
        vlanRow.releasedByName === "备注测试员" &&
        vlanRow.releaseBatchId === batch.releaseBatchId,
      "非区间资源批量释放应保存备注、操作人与批次",
    );

    const ipAllocation = await createAllocation(tx, {
      customerId: customerB.id,
      resourceType: "ipAddress",
      resourceId: noteIp.id,
      allocatedAt: "2026-11-01",
    });
    const single = await releaseAllocation(tx, ipAllocation.allocation.id, {
      releasedAt: "2026-11-05",
      releaseNote: "单个释放备注",
      releasedByName: "备注测试员",
    });
    const ipRow = await tx.resourceAllocation.findUniqueOrThrow({
      where: { id: ipAllocation.allocation.id },
    });
    assert(
      ipRow.releaseNote === "单个释放备注" &&
        ipRow.releaseBatchId === single.releaseBatchId &&
        ipRow.releaseBatchId !== null,
      "单个释放非区间资源也应保存释放信息",
    );
  });
  console.log("PASS 非区间资源释放备注/操作人/批次保存");

  console.log(`\n全部业务规则测试通过（供应商 ${supplier.name}，机柜 ${rangeRack.code} 等）。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
