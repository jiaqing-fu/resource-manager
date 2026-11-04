import { loadEnvFile } from "node:process";
import { addDays, todayStr } from "../src/lib/dates";

/**
 * 写入一套演示数据，便于验收页面与关联关系。
 * 仅在业务表为空时执行；不会清空或覆盖已有数据。
 */
async function main() {
  try {
    loadEnvFile();
  } catch {
    // 没有 .env 时使用当前环境变量
  }

  const { prisma } = await import("../src/lib/db");
  const [supplierCount, customerCount, salespersonCount] = await Promise.all([
    prisma.supplier.count(),
    prisma.customer.count(),
    prisma.salesperson.count(),
  ]);
  if (supplierCount + customerCount + salespersonCount > 0) {
    console.log("检测到已有业务数据，跳过演示数据写入（本脚本不会清空数据）。");
    await prisma.$disconnect();
    return;
  }

  const today = todayStr();

  try {
    await prisma.$transaction(async (tx) => {
      const telecom = await tx.supplier.create({
        data: {
          name: "中国电信",
          level: 1,
          category: "carrier",
          asn: 4134,
          contactName: "王经理",
          phone: "10000",
          email: "noc@example.com",
          status: "active",
          notes: "演示数据",
        },
      });
      await tx.supplier.create({
        data: {
          name: "中国电信上海分公司",
          level: 2,
          parentId: telecom.id,
          category: "carrier",
          contactName: "李工",
          phone: "021-10000",
          status: "active",
        },
      });
      const huawei = await tx.supplier.create({
        data: {
          name: "华为",
          level: 1,
          category: "vendor",
          contactName: "赵工",
          phone: "400-822-9999",
          status: "active",
        },
      });
      await tx.supplierContact.create({
        data: {
          supplierId: telecom.id,
          name: "王经理",
          role: "客户经理",
          phone: "10000",
          email: "noc@example.com",
          isPrimary: true,
          notes: "演示联系人",
        },
      });

      const zhangWei = await tx.salesperson.create({
        data: {
          name: "张伟",
          phone: "13800000010",
          status: "active",
          notes: "演示数据",
        },
      });
      const liNa = await tx.salesperson.create({
        data: {
          name: "李娜",
          phone: "13800000011",
          status: "active",
          notes: "演示数据",
        },
      });

      const xingchen = await tx.customer.create({
        data: {
          name: "星辰科技",
          level: 1,
          salespersonId: zhangWei.id,
          contactName: "刘工",
          phone: "13800000001",
          status: "active",
          notes: "演示数据",
        },
      });
      const xingchenSh = await tx.customer.create({
        data: {
          name: "星辰科技华东分部",
          level: 2,
          parentId: xingchen.id,
          salespersonId: zhangWei.id,
          contactName: "陈工",
          phone: "13800000002",
          status: "active",
        },
      });
      const yunfan = await tx.customer.create({
        data: {
          name: "云帆网络",
          level: 1,
          salespersonId: liNa.id,
          contactName: "周工",
          phone: "13900000003",
          status: "active",
        },
      });

      const rackShA01 = await tx.rack.create({
        data: {
          location: "上海一号机房 A 排 01",
          code: "SH-A01",
          status: "active",
          width: 19,
          uStart: 1,
          uEnd: 42,
          power: "双路 16A",
          supplierId: telecom.id,
          notes: "演示机柜",
        },
      });
      const rackShB02 = await tx.rack.create({
        data: {
          location: "上海一号机房 B 排 02",
          code: "SH-B02",
          status: "active",
          width: 19,
          uStart: 1,
          uEnd: 42,
          power: "双路 16A",
          supplierId: huawei.id,
        },
      });
      const rackBjA01 = await tx.rack.create({
        data: {
          location: "北京二号机房 A 排 01",
          code: "BJ-A01",
          status: "active",
          width: 19,
          uStart: 1,
          uEnd: 42,
          supplierId: telecom.id,
        },
      });

      const vlan100 = await tx.vlan.create({
        data: {
          vid: 100,
          name: "办公网",
          status: "active",
          supplierId: telecom.id,
        },
      });
      const vlan200 = await tx.vlan.create({
        data: {
          vid: 200,
          name: "客户业务",
          status: "active",
          supplierId: telecom.id,
          description: "演示 VLAN",
        },
      });
      await tx.vlan.create({
        data: {
          vid: 300,
          name: "传输互联",
          status: "active",
          supplierId: telecom.id,
        },
      });
      await tx.vxlan.create({
        data: {
          vni: 10200,
          name: "客户业务VXLAN",
          status: "active",
          vlanId: vlan200.id,
          supplierId: telecom.id,
          description: "演示 VXLAN",
        },
      });

      const block10 = await tx.ipBlock.create({
        data: {
          cidr: "10.10.0.0/16",
          ipVersion: 4,
          status: "container",
          role: "internal",
          supplierId: telecom.id,
          description: "内部地址容器",
        },
      });
      const block101 = await tx.ipBlock.create({
        data: {
          cidr: "10.10.1.0/24",
          parentId: block10.id,
          ipVersion: 4,
          status: "active",
          role: "customer_pool",
          vlanId: vlan200.id,
          supplierId: telecom.id,
          gateway: "10.10.1.1",
          assignedAt: addDays(today, -60),
          description: "星辰科技客户地址池",
        },
      });
      const block102 = await tx.ipBlock.create({
        data: {
          cidr: "10.10.2.0/24",
          parentId: block10.id,
          ipVersion: 4,
          status: "active",
          role: "internal",
          vlanId: vlan100.id,
          supplierId: telecom.id,
          gateway: "10.10.2.1",
          description: "内部管理网",
        },
      });
      const blockTransit = await tx.ipBlock.create({
        data: {
          cidr: "203.0.113.0/24",
          ipVersion: 4,
          status: "active",
          role: "transit",
          supplierId: telecom.id,
          gateway: "203.0.113.1",
          description: "互联网传输段",
        },
      });
      const blockCustomer = await tx.ipBlock.create({
        data: {
          cidr: "198.51.100.0/24",
          ipVersion: 4,
          status: "active",
          role: "customer_pool",
          supplierId: telecom.id,
          gateway: "198.51.100.1",
          description: "云帆网络地址池",
        },
      });

      const core = await tx.device.create({
        data: {
          name: "SH-CORE-01",
          type: "router",
          role: "core",
          status: "active",
          manufacturer: "Huawei",
          model: "NE40E",
          serialNo: "DEMO-SN-CORE-001",
          osVersion: "7.16.2",
          rackId: rackShA01.id,
          uStart: 40,
          uHeight: 2,
          face: "front",
          supplierId: huawei.id,
          owner: "网络组",
          lastInventoryAt: today,
          purchaseDate: addDays(today, -700),
          warrantyEnd: addDays(today, 25),
          notes: "演示设备",
        },
      });
      const switchSh = await tx.device.create({
        data: {
          name: "SH-SW-01",
          type: "switch",
          role: "access",
          status: "active",
          manufacturer: "Huawei",
          model: "S5735",
          serialNo: "DEMO-SN-SW-001",
          osVersion: "7.15.3",
          rackId: rackShA01.id,
          uStart: 20,
          uHeight: 1,
          face: "front",
          supplierId: huawei.id,
          owner: "网络组",
          lastInventoryAt: today,
          purchaseDate: addDays(today, -400),
          warrantyEnd: addDays(today, 320),
        },
      });
      const edgeBj = await tx.device.create({
        data: {
          name: "BJ-EDGE-01",
          type: "router",
          role: "customer_edge",
          status: "active",
          manufacturer: "MikroTik",
          model: "CCR2004",
          serialNo: "DEMO-SN-EDGE-001",
          osVersion: "7.16.2",
          rackId: rackBjA01.id,
          uStart: 10,
          uHeight: 1,
          face: "front",
          supplierId: telecom.id,
          owner: "网络组",
          lastInventoryAt: today,
          purchaseDate: addDays(today, -200),
          warrantyEnd: addDays(today, 540),
        },
      });

      await tx.ipAddress.create({
        data: {
          address: "10.10.2.1",
          blockId: block102.id,
          status: "active",
          role: "management",
          supplierId: telecom.id,
          rackId: rackShA01.id,
          deviceId: core.id,
          isPrimary: true,
          dnsName: "sh-core-01.example.internal",
          assignedAt: addDays(today, -700),
        },
      });
      await tx.ipAddress.create({
        data: {
          address: "10.10.2.20",
          blockId: block102.id,
          status: "active",
          role: "vip",
          supplierId: telecom.id,
          dnsName: "portal.example.internal",
          description: "客户门户 VIP",
          assignedAt: addDays(today, -90),
        },
      });
      const ipCustomer = await tx.ipAddress.create({
        data: {
          address: "10.10.1.10",
          blockId: block101.id,
          status: "active",
          role: "customer",
          supplierId: telecom.id,
          rackId: rackShA01.id,
          deviceId: switchSh.id,
          isPrimary: true,
          dnsName: "xingchen-gw.example",
          assignedAt: addDays(today, -60),
        },
      });
      const ipTransit = await tx.ipAddress.create({
        data: {
          address: "203.0.113.10",
          blockId: blockTransit.id,
          status: "active",
          role: "transit",
          supplierId: telecom.id,
          deviceId: core.id,
          dnsName: "www.example.com",
          description: "官网出口",
          assignedAt: addDays(today, -700),
        },
      });
      await tx.ipAddress.create({
        data: {
          address: "198.51.100.10",
          blockId: blockCustomer.id,
          status: "active",
          role: "customer",
          supplierId: telecom.id,
          rackId: rackBjA01.id,
          deviceId: edgeBj.id,
          isPrimary: true,
          assignedAt: addDays(today, -180),
        },
      });
      const line1 = await tx.line.create({
        data: {
          code: "SH-INTERNET-01",
          name: "上海电信互联网专线",
          type: "internet",
          status: "active",
          supplierId: telecom.id,
          bandwidthMbps: 1000,
          monthlyFeeCents: 800000,
          circuitNo: "CT-SH-0001",
          installDate: addDays(today, -365),
          expireDate: addDays(today, 20),
          description: "演示线路，20 天后到期",
          terminations: {
            create: [
              {
                side: "A",
                rackId: rackShA01.id,
                deviceId: core.id,
                port: "GE0/0/1",
                description: "运营商接入",
              },
              {
                side: "Z",
                rackId: rackShB02.id,
                description: "机房内跳线",
              },
            ],
          },
        },
      });
      const line2 = await tx.line.create({
        data: {
          code: "SH-MPLS-02",
          name: "上海-北京 MPLS",
          type: "mpls",
          status: "active",
          supplierId: telecom.id,
          bandwidthMbps: 200,
          monthlyFeeCents: 300000,
          circuitNo: "CT-MPLS-0002",
          installDate: addDays(today, -200),
          expireDate: addDays(today, 300),
          terminations: {
            create: [
              {
                side: "A",
                rackId: rackShA01.id,
                deviceId: core.id,
                port: "GE0/0/2",
              },
              {
                side: "Z",
                rackId: rackBjA01.id,
                deviceId: edgeBj.id,
                port: "ether1",
              },
            ],
          },
        },
      });
      await tx.ipAddress.update({
        where: { id: ipTransit.id },
        data: { lineId: line1.id },
      });

      const broadband1 = await tx.broadband.create({
        data: {
          name: "SH-BW-01",
          supplierId: telecom.id,
          bandwidthMbps: 1000,
          status: "active",
          expireDate: addDays(today, 18),
          account: "SH10000001",
          password: "demo-password",
          installAddress: "上海市浦东新区示例路 100 号",
          rackId: rackShA01.id,
          deviceId: core.id,
          lineId: line1.id,
          ipAddressId: ipTransit.id,
          monthlyFeeCents: 800000,
          contractNo: "CT-BW-2026-001",
          description: "演示宽带，18 天后到期",
        },
      });
      await tx.broadband.create({
        data: {
          name: "BJ-BW-01",
          supplierId: telecom.id,
          bandwidthMbps: 200,
          status: "planned",
          expireDate: addDays(today, 300),
          account: "BJ10000002",
          installAddress: "北京市朝阳区示例路 8 号",
          rackId: rackBjA01.id,
          deviceId: edgeBj.id,
          lineId: line2.id,
          monthlyFeeCents: 300000,
          contractNo: "CT-BW-2026-002",
        },
      });

      // 资源分配：机柜/宽带可多客户共享，其他资源同时只有一条有效分配。
      await tx.resourceAllocation.create({
        data: {
          customerId: xingchen.id,
          resourceType: "rack",
          resourceName: `${rackShA01.code} [1-42]U`,
          supplierName: telecom.name,
          uStart: 1,
          uEnd: 42,
          activeKey: null,
          rackId: rackShA01.id,
          allocatedAt: new Date(addDays(today, -180)),
          notes: "演示分配",
        },
      });
      await tx.rack.update({
        where: { id: rackShA01.id },
        data: { customerId: xingchen.id },
      });
      await tx.resourceAllocation.create({
        data: {
          customerId: yunfan.id,
          resourceType: "rack",
          resourceName: `${rackBjA01.code} [1-42]U`,
          supplierName: telecom.name,
          uStart: 1,
          uEnd: 42,
          activeKey: null,
          rackId: rackBjA01.id,
          allocatedAt: new Date(addDays(today, -150)),
          notes: "演示分配",
        },
      });
      await tx.rack.update({
        where: { id: rackBjA01.id },
        data: { customerId: yunfan.id },
      });

      await tx.resourceAllocation.create({
        data: {
          customerId: yunfan.id,
          resourceType: "device",
          resourceName: edgeBj.name,
          supplierName: telecom.name,
          activeKey: `device:${edgeBj.id}`,
          deviceId: edgeBj.id,
          allocatedAt: new Date(addDays(today, -150)),
          notes: "演示分配",
        },
      });
      await tx.device.update({
        where: { id: edgeBj.id },
        data: { customerId: yunfan.id },
      });

      await tx.resourceAllocation.create({
        data: {
          customerId: xingchenSh.id,
          resourceType: "ipBlock",
          resourceName: block101.cidr,
          supplierName: telecom.name,
          activeKey: `ipBlock:${block101.id}`,
          ipBlockId: block101.id,
          allocatedAt: new Date(addDays(today, -60)),
          notes: "演示分配",
        },
      });
      await tx.ipBlock.update({
        where: { id: block101.id },
        data: { customerId: xingchenSh.id },
      });
      await tx.resourceAllocation.create({
        data: {
          customerId: yunfan.id,
          resourceType: "ipBlock",
          resourceName: blockCustomer.cidr,
          supplierName: telecom.name,
          activeKey: `ipBlock:${blockCustomer.id}`,
          ipBlockId: blockCustomer.id,
          allocatedAt: new Date(addDays(today, -180)),
          notes: "演示分配",
        },
      });
      await tx.ipBlock.update({
        where: { id: blockCustomer.id },
        data: { customerId: yunfan.id },
      });

      await tx.resourceAllocation.create({
        data: {
          customerId: xingchenSh.id,
          resourceType: "ipAddress",
          resourceName: ipCustomer.address,
          supplierName: telecom.name,
          activeKey: `ipAddress:${ipCustomer.id}`,
          ipAddressId: ipCustomer.id,
          allocatedAt: new Date(addDays(today, -60)),
          notes: "演示分配",
        },
      });
      await tx.ipAddress.update({
        where: { id: ipCustomer.id },
        data: { customerId: xingchenSh.id },
      });

      await tx.resourceAllocation.create({
        data: {
          customerId: xingchen.id,
          resourceType: "line",
          resourceName: `${line1.code} ${line1.name}`,
          supplierName: telecom.name,
          activeKey: `line:${line1.id}`,
          lineId: line1.id,
          allocatedAt: new Date(addDays(today, -365)),
          notes: "演示分配",
        },
      });
      await tx.line.update({
        where: { id: line1.id },
        data: { customerId: xingchen.id },
      });
      await tx.resourceAllocation.create({
        data: {
          customerId: yunfan.id,
          resourceType: "line",
          resourceName: `${line2.code} ${line2.name}`,
          supplierName: telecom.name,
          activeKey: `line:${line2.id}`,
          lineId: line2.id,
          allocatedAt: new Date(addDays(today, -200)),
          notes: "演示分配",
        },
      });
      await tx.line.update({
        where: { id: line2.id },
        data: { customerId: yunfan.id },
      });

      await tx.resourceAllocation.create({
        data: {
          customerId: xingchen.id,
          resourceType: "broadband",
          resourceName: broadband1.name,
          supplierName: telecom.name,
          allocatedMbps: 1000,
          activeKey: null,
          broadbandId: broadband1.id,
          allocatedAt: new Date(addDays(today, -300)),
          notes: "演示分配",
        },
      });
      await tx.broadband.update({
        where: { id: broadband1.id },
        data: { customerId: xingchen.id },
      });

      await tx.businessSystem.create({
        data: {
          name: "企业官网",
          code: "WEB",
          owner: "张伟",
          department: "技术部",
          environment: "prod",
          criticality: "core",
          status: "active",
          url: "https://www.example.com",
          domain: "www.example.com",
          onlineDate: addDays(today, -700),
          description: "演示业务系统",
          endpoints: {
            create: [
              {
                ipAddressId: ipTransit.id,
                protocol: "tcp",
                port: 443,
                isPrimary: true,
                description: "HTTPS 入口",
              },
              {
                ipText: "10.10.2.20",
                protocol: "tcp",
                port: 8080,
                description: "内网管理端口",
              },
            ],
          },
        },
      });
      await tx.businessSystem.create({
        data: {
          name: "客户自助门户",
          code: "CUSTOMER-PORTAL",
          owner: "李娜",
          department: "技术部",
          environment: "prod",
          criticality: "important",
          status: "active",
          domain: "portal.example.com",
          onlineDate: addDays(today, -120),
          endpoints: {
            create: [
              {
                ipAddressId: ipCustomer.id,
                protocol: "tcp",
                port: 443,
                isPrimary: true,
              },
            ],
          },
        },
      });

      await tx.customerTest.createMany({
        data: [
          {
            seqNo: 1,
            customerId: xingchen.id,
            companyName: "星辰科技",
            salesperson: "张伟",
            content: "100M 专线接入测试",
            startAt: addDays(today, -10),
            endAt: addDays(today, -3),
            accepted: false,
            converted: false,
            status: null,
            notes: "演示：已到期未处理",
          },
          {
            seqNo: 2,
            customerId: yunfan.id,
            companyName: "云帆网络",
            salesperson: "李娜",
            content: "MPLS 链路测试",
            startAt: today,
            endAt: addDays(today, 7),
            accepted: true,
            converted: false,
            status: null,
            notes: "演示：测试中",
          },
          {
            seqNo: 3,
            customerId: xingchen.id,
            companyName: "星河数据（未建客户）",
            salesperson: "张伟",
            content: "防火墙策略测试",
            startAt: addDays(today, -6),
            endAt: addDays(today, 1),
            accepted: false,
            converted: false,
            status: "failed",
            notes: "演示：测试未通过",
          },
        ],
      });
    });

    console.log("演示数据已写入：");
    console.log("  供应商：中国电信（含二级）、华为");
    console.log("  客户：星辰科技（含二级）、云帆网络");
    console.log(
      "  机柜 3 个、VLAN 3 个、VXLAN 1 个、IP 段 5 个、IP 5 个、设备 3 台、线路 2 条、宽带 2 条、资源分配 9 条、业务系统 2 个、测试 3 条",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("写入演示数据失败：", error);
  process.exitCode = 1;
});
