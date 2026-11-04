-- 业务员主数据 + 客户单一业务员绑定
-- 将 Customer.salesperson 的历史自由文本迁移为 Salesperson 记录，并改为 salespersonId 外键。
PRAGMA foreign_keys=OFF;
PRAGMA defer_foreign_keys=ON;

-- 1. 业务员表
CREATE TABLE "Salesperson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Salesperson_name_key" ON "Salesperson"("name");
CREATE INDEX "Salesperson_status_idx" ON "Salesperson"("status");

-- 2. 从客户历史文本回填：去首尾空白、去重、忽略空串
INSERT INTO "Salesperson" ("id", "name", "status", "createdAt", "updatedAt")
SELECT 'sp_' || lower(hex(randomblob(12))), "name", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT TRIM("salesperson") AS "name"
    FROM "Customer"
    WHERE "salesperson" IS NOT NULL AND TRIM("salesperson") <> ''
);

-- 3. 重建 Customer：删除 salesperson 文本列，新增 salespersonId 外键
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parentId" TEXT,
    "salespersonId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "Salesperson" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Customer" (
    "id", "name", "level", "parentId", "salespersonId",
    "contactName", "phone", "email", "address", "status", "notes",
    "createdAt", "updatedAt"
)
SELECT
    c."id", c."name", c."level", c."parentId",
    s."id",
    c."contactName", c."phone", c."email", c."address", c."status", c."notes",
    c."createdAt", c."updatedAt"
FROM "Customer" c
LEFT JOIN "Salesperson" s ON s."name" = TRIM(c."salesperson");

DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";

CREATE INDEX "Customer_level_parentId_idx" ON "Customer"("level", "parentId");
CREATE INDEX "Customer_name_idx" ON "Customer"("name");
CREATE INDEX "Customer_salespersonId_idx" ON "Customer"("salespersonId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
PRAGMA foreign_key_check;
