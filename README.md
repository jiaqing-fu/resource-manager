# 技术部资源管理系统

面向技术部的内网资源台账系统，打通 **客户 — 供应商 — 资源 — 资源分配** 的核心关系：

- 客户管理与供应商管理拆分为两个独立一级菜单
- 业务员管理：维护业务员主数据，客户可绑定一个业务员，客户列表支持按业务员筛选
- 资源管理：机柜（含前后 U 位图）、IP 管理（IP 段树、IP 地址）、LAN 管理（VLAN、VXLAN）、宽带、线路（A/Z 端）、设备
- 资源分配：把 9 类资源关联到客户，保留完整分配/释放历史
- 客户测试统计、业务系统登记
- 通知管理：富文本撰写通知，生成 Word 文档、通过 SMTP 发送邮件并保存本地副本
- 供应商联系方式（名录 + 联系人）

9 类资源（机柜、IP 段、IP 区间、IP 地址、VLAN、VXLAN、宽带、线路、设备）创建时必须关联供应商；部分类型可从父级网段、VLAN、机柜、设备或线路继承。客户归属不再由资源表单直接填写，只能通过「资源分配」产生。

供应商与客户均为严格两级：**一级必须存在，二级必须挂在一级下，二级可以不存在**。系统为内网多人使用，提供管理员/普通用户两级权限、标准 Excel 模板导入导出、到期提醒、全局搜索与变更记录。

## 技术栈

- Next.js 16（App Router）+ React 19 + TypeScript
- Ant Design 6
- Prisma 6 + SQLite（单文件数据库，无需单独安装数据库服务）
- `jose` JWT + `bcryptjs`，httpOnly Cookie 登录
- `exceljs` 生成/解析标准 Excel 模板，`ipaddr.js` 处理 CIDR
- TipTap 富文本编辑，`docx` 生成 Word 文档，`nodemailer` 通过 SMTP 发送邮件

## 目录

```
prisma/schema.prisma          数据模型与迁移
src/app/(main)/               业务页面
src/app/api/                  接口
src/lib/                      鉴权、枚举、校验、Excel、IP 计算等
src/server/                   业务规则（IPAM、状态计算、导入导出）
scripts/init.ts               初始化管理员
scripts/seed-demo.ts          写入演示数据（仅在业务表为空时）
scripts/backup.ts             SQLite 在线备份
scripts/deploy.sh             生产构建/迁移/可选重启
deploy/resource-manager.service  systemd 单元
data/app.db                   SQLite 数据库（运行时生成，已 gitignore）
```

## 快速开始

要求：Node.js 24（或 22+）、npm。

```bash
cd /home/lcadmin/APP/resource-manager

cp .env.example .env
# 编辑 .env，至少设置一个随机 AUTH_SECRET：
openssl rand -base64 48

mkdir -p data
npm ci
npm run db:deploy       # 应用数据库迁移
npm run db:init         # 创建 admin 管理员，密码只显示一次
npm run dev             # 开发模式：http://localhost:3000
```

说明：

- `db:init` 优先使用 `SEED_ADMIN_PASSWORD`；未设置时随机生成并打印一次，请立即保存。
- 已有启用管理员时 `db:init` 会跳过，不会重置密码或覆盖数据。
- 可选演示数据：`npm run db:seed:demo`。该脚本只在供应商、客户、机柜和 IP 段都为空时写入，不会清空数据。
- 开发时如使用 `npm run dev`，可将 `.env` 中的 `NODE_ENV` 改为 `development`；生产必须为 `production`。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | SQLite 连接串，默认 `file:../data/app.db`（相对 `prisma/`） |
| `AUTH_SECRET` | 是 | JWT 签名密钥，至少 32 个字符；生成：`openssl rand -base64 48` |
| `SEED_ADMIN_PASSWORD` | 否 | 仅 `db:init` 首次建管理员时使用，之后可删除 |
| `PORT` | 否 | 监听端口，默认 `3000` |
| `HOSTNAME` | 否 | 监听地址，默认 `0.0.0.0` |
| `TZ` | 否 | 时区，固定 `Asia/Shanghai` |
| `NODE_ENV` | 否 | 生产为 `production` |
| `COOKIE_SECURE` | 否 | 通过 HTTPS 访问时设为 `1`；纯内网 HTTP 保持 `0` |
| `BACKUP_DIR` | 否 | 备份目录，默认 `data/backups` |
| `BACKUP_RETENTION_DAYS` | 否 | 备份保留天数，默认 `30` |
| `SMTP_HOST` | 通知发送时是 | SMTP 服务器地址 |
| `SMTP_PORT` | 否 | 端口，默认 `465` |
| `SMTP_SECURE` | 否 | `1` 使用 SSL/TLS（465），`0` 使用 STARTTLS（587）；留空按端口推断 |
| `SMTP_USER` | 否 | SMTP 用户名；与 `SMTP_PASS` 必须同时配置或同时留空 |
| `SMTP_PASS` | 否 | SMTP 密码，仅保存在 `.env`，不会写入数据库或返回前端 |
| `SMTP_FROM` | 通知发送时是 | 发件地址，可写 `技术部 <notice@example.com>`；留空回退到 `SMTP_USER` |
| `SMTP_FROM_NAME` | 否 | 发件人显示名 |
| `NOTIFICATION_DEFAULT_TO` | 否 | 新建通知时预填的默认收件人，多个用逗号分隔 |
| `NOTIFICATION_STORAGE_DIR` | 否 | Word 副本目录，默认 `data/notifications`；不要指向 `/tmp` |

`.env` 内含密钥，权限应为 `600`：

```bash
chmod 600 .env
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务（需先 build） |
| `npm run typecheck` | TypeScript 检查 |
| `npm run lint` | ESLint |
| `npm run db:deploy` | 生产环境应用迁移（只用这个） |
| `npm run db:migrate` | 开发环境创建迁移 |
| `npm run db:init` | 初始化管理员 |
| `npm run db:seed:demo` | 写入演示数据 |
| `npm run backup` | 在线备份数据库 |
| `npm run deploy` | 安装依赖 → 备份 → 迁移 → 构建 |

`npm run db:reset` 会清空数据库，只允许在开发环境使用。

## 生产部署

生产只运行一个实例（SQLite 单写）。不要使用 pm2 cluster 或多副本。

### 首次部署

```bash
cd /home/lcadmin/APP/resource-manager
cp .env.example .env
# 设置 AUTH_SECRET、NODE_ENV=production 等
chmod 600 .env

bash scripts/deploy.sh     # npm ci + 迁移 + 构建（首次没有数据库会跳过备份）
npm run db:init            # 创建管理员，保存打印出的密码

sudo cp deploy/resource-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now resource-manager
sudo systemctl status resource-manager
```

systemd 单元默认使用：

- 用户/组 `lcadmin`
- 项目目录 `/home/lcadmin/APP/resource-manager`
- Node `/home/lcadmin/APP/node-v24.15.0-linux-x64/bin/node`
- 端口 `3000`，监听 `0.0.0.0`
- 服务异常自动重启

如实际路径不同，修改 `deploy/resource-manager.service` 后重新 `daemon-reload`。

### 后续更新

```bash
cd /home/lcadmin/APP/resource-manager
RESTART=1 bash scripts/deploy.sh
```

`scripts/deploy.sh` 会先校验 `AUTH_SECRET`，执行 `npm ci`、数据库备份、`prisma migrate deploy` 和 `npm run build`，最后按 `RESTART=1` 重启服务。生产环境禁止用 `prisma migrate dev`。

查看日志：

```bash
journalctl -u resource-manager -f
```

## 备份与恢复

### 备份

```bash
npm run backup
```

备份使用 SQLite `VACUUM INTO` 生成一致性快照，不需要停服务；文件位于 `data/backups/app-YYYYMMDD-HHmmss.db`。通知 Word 副本会一并复制到 `data/backups/notifications-YYYYMMDD-HHmmss/`，默认清理 30 天前的数据库备份和文档备份目录。

建议为 `lcadmin` 配置每日定时任务：

```cron
0 2 * * * cd /home/lcadmin/APP/resource-manager && PATH=/home/lcadmin/APP/node-v24.15.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin npm run backup >> data/backup.log 2>&1
```

请把备份文件定期复制到另一台机器或备份服务器，单一磁盘上的备份不算可靠备份。

### 恢复

```bash
sudo systemctl stop resource-manager
cd /home/lcadmin/APP/resource-manager

cp data/app.db data/app.db.before-restore   # 留一份当前库
rm -f data/app.db-wal data/app.db-shm
cp data/backups/app-YYYYMMDD-HHmmss.db data/app.db
chmod 600 data/app.db

# 如需同时恢复通知 Word 副本（先确认目录内容再覆盖）
rm -rf data/notifications
cp -a data/backups/notifications-YYYYMMDD-HHmmss data/notifications
chmod 700 data/notifications

sudo systemctl start resource-manager
```

恢复后登录检查数据。不要直接编辑正在使用的 `.db` 文件。

## 标准 Excel 模板与导入

现有 Excel 仅作为数据来源，不作为系统字段或表头依据。所有导入必须使用系统生成的模板：

1. 进入对应模块页面，点击 **下载模板**。
2. 模板包含固定中文表头（必填列带 `*`）、枚举下拉、日期校验、示例行、填写说明和参考数据页。
3. 技术人员按模板填写，不要改表头、增删列或改工作表名。
4. 在页面上传 `.xlsx`：先 **预校验**，通过后再 **确认导入**。

导入规则：

- 仅管理员可导入；普通用户可以下载模板和导出。
- 全有或全无：任意一行校验失败，整批不写入，并返回工作表、行号、列名、原因和当前值。
- 单文件不超过 5MB、5000 行，仅 `.xlsx`。
- 按自然键新增或更新；唯一键重复按错误处理。
- 模板带模块标识和版本号；系统升级后旧模板会被拒绝，请重新下载。
- 日期统一 `YYYY-MM-DD`；IP 段支持标准 CIDR 或 IPv4 闭区间 `起始IP-结束IP`；状态、类型必须使用模板中的中文枚举。
- `ip-blocks` / `ip-addresses` 模板版本为 2.1，旧模板会被拒绝，请重新下载。导入 IP 区间（如 `10.99.1.0-10.99.1.255`）会自动生成区间内全部 IP（每段最多 4096 个）；重复导入只补齐缺失地址，不重复创建。
- VLAN 与 VXLAN 已拆成独立模块：VLAN 表不含 VXLAN 列；VXLAN 表通过「关联 VLAN ID」建立可选关系，一个 VLAN 最多一个 VXLAN。VNI 全局唯一，范围 1-16777215。
- 创建 9 类资源时最终供应商必须非空。机柜、VLAN、宽带、线路必须显式填写供应商；IP 段可从父段或 VLAN 继承，IP 地址可从网段、设备、机柜或线路继承，VXLAN 可从 VLAN 继承，设备可从机柜继承。
- 资源表不再包含客户列。客户归属只能通过「资源分配」页面产生，Excel 不导入分配记录。
- 客户模板的「业务员」列按姓名引用参考数据。业务员必须先在「业务员管理」中创建（仅管理员），导入不会自动创建；姓名不存在时按行报错。
- 机柜模板 3.0 使用「起始 U 位」「结束 U 位」代替总 U 数；同一机柜编号可有多条互不重叠的区间记录。设备导入按「机柜编号 + 起始 U 位」匹配具体区间；同一编号对应多个区间时，IP 地址、宽带、线路端点等没有 U 位信息的模块会明确报错，需改用唯一编号或先拆分数据。

建议导入顺序（后一个模块可能引用前一个模块的数据）：

1. 业务员（可由管理员在页面批量新增或 Excel 导入）
2. 供应商 + 联系方式
3. 客户
4. 机柜
5. VLAN
6. VXLAN
7. IP 段/区间（按覆盖范围从大到小，父段先于子段）
8. 设备
9. 线路 + A/Z 端
10. IP 地址
11. 宽带
12. 业务系统 + 端点
13. 客户测试

存量数据整理建议：先统一供应商/客户名称与层级并去重；将 IP 段转换为标准 CIDR 或 IPv4 闭区间并建立父子关系；把旧状态/类型映射到系统枚举；先建供应商、机柜、VLAN、设备等被引用主数据；无法映射且确需保留的字段先放入备注，再单独评审是否入模型。

## 业务员与客户

- 「业务员管理」是独立一级菜单，仅管理员可见和维护；普通用户仍可在客户表单中选择业务员。
- 业务员字段：姓名（全局唯一）、电话、状态（启用/停用）、备注。
- 支持页面批量新增，以及标准 Excel 模板导入/导出；导入按姓名新增或更新，姓名重复时更新电话、状态和备注。
- 一个客户最多绑定一个业务员，可不绑定；停用的业务员保留历史绑定，但不能在客户表单中新选。
- 客户列表显示业务员姓名，并支持按业务员筛选；搜索关键字也会匹配业务员姓名。
- 仍有客户绑定的业务员不能删除，需先在客户管理中解除绑定；删除业务员不会级联删除客户。

## 资源分配

「资源分配」位于 **客户管理 → 资源分配**，用于把资源关联到客户：

- 支持机柜、IP 段、IP 区间、IP 地址、VLAN、VXLAN、宽带、线路、设备 9 类资源；「新增分配」打开多客户批量工作台，每个客户分组按 9 个资源分区列出当前有效分配。
- 每个客户分组用 `+` 新增草稿行、`-` 删除草稿行；已有分配可标记「待释放」并撤销。整批共享分配日期、释放日期和备注，一次保存多个客户与多项资源，服务端在同一个事务内先释放、再新增，任一失败全部回滚。
- 除机柜、宽带和 IP 区间外，同一资源同时只能有一条未释放分配；不同客户在同一批中也不能重复选择同一资源（同一段内互不重叠的 IP 区间可以分给不同客户）。
- IP 区间分配：选择叶子 IP 段后填写起止 IPv4，区间必须落在该段覆盖范围内且不超过 4096 个地址；同一段可有多条互不重叠的区间分配。IP 区间分配与单 IP 分配互斥：已分配单 IP 不能落入区间，区间内地址也不能再按单 IP 分配；整段 IP 分配不受影响，可与区间/单 IP 分配并存。创建区间分配时若地址尚未录入会自动补齐该区间地址，并同步地址的客户缓存；释放后自动清除。
- IP 段支持 CIDR 与 IPv4 闭区间（如 `10.99.1.0-10.99.1.255`）。区间段创建时自动生成闭区间内全部地址（含网络/广播地址，每段最多 4096 个），编辑扩展区间会自动补齐；区间段不提供「批量生成」，删除段时可一并删除未被使用的直属 IP，存在子段、有效分配、业务系统端点或宽带引用时整体拒绝。利用率主指标为「已分配/容量」，同时保留「已录入 IP 数」。
- 机柜记录表示物理机柜的一段 `[uStart,uEnd]U`，同一编号可有多条互不重叠记录。分配时先选机柜记录，再填写该记录内的起止 U；同一机柜的有效分配区间互斥。设备上架区间可以与该机柜分配区间重叠，但设备之间同一安装面互斥，前后两面可共用 U 位。
- 宽带分配需填写正整数 MBPS，允许超过宽带总带宽；宽带复用率 = 有效分配 MBPS 之和 ÷ 总带宽，可超过 100%。
- 机柜、宽带的客户列和客户筛选按有效分配动态汇总：一个客户显示名称，多个客户显示「N 个客户」。资源表上的 `customerId` 仅作兼容缓存，新增/释放后自动重算。
- 释放时填写释放日期，历史记录永久保留，资源可再次分配；释放日期不能早于分配日期。
- 有未释放分配的资源不能删除；有分配历史的客户不能删除。
- 历史数据中资源原有的 `customerId` 已在升级迁移时回填为分配记录，备注为「由历史 customerId 回填」。
- 宽带管理页展示每条宽带的已分配 MBPS 与复用率；页面上方提供可折叠的横向柱状图，展示**全部**宽带（不受筛选和分页影响），按复用率倒序，100% 处有参考线，超过 100% 标红。

## 批量新增与搜索

- 所有新增抽屉支持批量：每张卡片顶部有「新增 / 删除」按钮；「新增」复制当前条目的全部字段（含日期和嵌套数组），「删除」移除当前条目。编辑仍为单条。
- 批量提交逐条调用接口，跨条不是事务；失败时会提示已成功条数与失败序号。
- 所有列表支持模糊搜索，输入停止 400ms 后自动查询，无需回车；回车和清空会立即触发。中文输入法组合输入期间不会误触发。

## 通知与邮件

「通知管理」用于撰写、保存、发送带 Word 附件的通知：

- 新建通知后，正文用富文本编辑（加粗、斜体、下划线、删除线、标题、项目/编号列表、引用、撤销/重做）。
- **保存草稿**允许标题、收件人或正文暂时为空；**发送**前会强校验标题、收件人、正文和通知日期。
- 发送时生成 `.docx`，保存到 `NOTIFICATION_STORAGE_DIR`（默认 `data/notifications/`），再通过 SMTP 发送给页面填写的收件人/抄送人。
- 已发送记录只读、不可删除；发送失败可修改后重试，本地 Word 副本会保留。
- 列表和编辑器均可下载 Word；本地副本缺失时会按数据库内容重新生成。
- 发送失败时错误信息会脱敏截断后显示在页面；SMTP 密码不会返回浏览器。

配置示例（生产 `.env`，权限保持 `600`）：

```dotenv
SMTP_HOST="smtp.example.com"
SMTP_PORT="465"
SMTP_SECURE="1"
SMTP_USER="notice@example.com"
SMTP_PASS="请填写邮箱授权码或密码"
SMTP_FROM="技术部 <notice@example.com>"
SMTP_FROM_NAME="技术部"
NOTIFICATION_DEFAULT_TO=""
NOTIFICATION_STORAGE_DIR="data/notifications"
```

修改 `.env` 后需要重启服务。未配置 SMTP 时仍可新建、保存和下载 Word，发送按钮会禁用并提示原因。不要把 `SMTP_PASS` 写入代码、数据库、日志或提交到仓库。

## 权限

| 操作 | 管理员 ADMIN | 普通用户 USER |
|---|---|---|
| 查看、搜索、筛选 | ✓ | ✓ |
| 新增、编辑 | ✓ | ✓ |
| 导出、下载模板 | ✓ | ✓ |
| 删除 | ✓ | ✗ |
| 业务员主数据维护（新增/编辑/删除/导入） | ✓ | ✗ |
| 客户绑定/解除业务员 | ✓ | ✓ |
| Excel 导入 | ✓ | ✗ |
| 用户管理 | ✓ | ✗ |
| 全局变更记录 | ✓ | ✗ |

权限在服务端接口强制校验，前端隐藏按钮只是辅助。

## 主要路由

| 路由 | 功能 |
|---|---|
| `/` | 工作台：资源总览、分布、到期提醒 |
| `/customers` | 客户两级名录（含业务员绑定与筛选） |
| `/salespersons` | 业务员管理（管理员维护） |
| `/resource-allocations` | 资源分配与释放历史 |
| `/suppliers` | 供应商名录与联系方式 |
| `/customer-tests` | 客户测试统计 |
| `/notifications` | 通知列表、Word 下载与发送记录 |
| `/notifications/new` | 新建通知（富文本 Word 文档） |
| `/notifications/[id]` | 查看/编辑通知、发送邮件 |
| `/business-systems` | 业务系统与端点 |
| `/racks` | 机柜与前后 U 位图 |
| `/ip/blocks` | IP 段/区间树、子段、双指标利用率、VLAN |
| `/ip/addresses` | IP 地址台账与关联资源 |
| `/vlans` | VLAN 台账 |
| `/vxlans` | VXLAN 台账与 VLAN 关联 |
| `/broadbands` | 宽带台账（账号、安装地址、关联资源、费用） |
| `/lines` | 线路与 A/Z 端 |
| `/devices` | 设备台账 |
| `/users` | 用户管理（管理员） |
| `/profile` | 修改密码 |
| `/changelog` | 变更记录（管理员） |

已删除机房（Datacenter）模块；机柜的「位置」为文本字段，原机房名在迁移时回填到空位置。历史变更记录中的机房标签仅作兼容展示。

## 常见问题

**登录提示用户名或密码错误**

确认已执行 `npm run db:init`，并使用当时打印的密码或 `SEED_ADMIN_PASSWORD`。连续失败会触发登录限流，稍后再试。

**启动报 AUTH_SECRET 错误**

`.env` 中 `AUTH_SECRET` 缺失或少于 32 个字符。重新生成并设为至少 32 字符：

```bash
openssl rand -base64 48
```

**端口被占用**

修改 `.env` 的 `PORT`，或修改 systemd 单元中的 `-p` 参数。

**数据库被锁定 / `SQLITE_BUSY`**

只能运行一个应用实例；不要同时运行 `npm run dev` 和生产服务。系统已启用 WAL 和 5 秒 busy timeout，导入操作会串行执行。

**通知页面提示 SMTP 未配置**

在服务器 `.env` 中填写 `SMTP_HOST`、`SMTP_FROM`，按需填写 `SMTP_USER`/`SMTP_PASS`，然后重启服务。只配置用户名或只配置密码会被视为配置不完整；本地中继允许同时留空。

**通知发送失败**

页面会显示截断后的 SMTP 错误。常见原因：端口/加密方式不匹配（465 用 `SMTP_SECURE=1`，587 用 `0`）、邮箱授权码错误、发件地址与账号不匹配、服务器网络或防火墙限制。失败记录及本地 Word 副本会保留，修正后可重试；失败通知不会自动重发。

**模板提示版本不符**

系统升级后模板版本会变化。重新下载模板，把数据复制到新模板再上传。

**忘记管理员密码**

优先让另一个管理员在 `/users` 重置。若只有一个管理员，请先备份 `data/app.db`，再联系维护人员处理；不要直接修改数据库中的密码哈希。

**页面打不开或接口 401**

会话有效期 8 小时，修改密码或停用账号会使旧会话立即失效。重新登录即可。

## 安全与运维建议

- 仅在内网开放端口，使用防火墙限制来源网段。
- 纯 HTTP 环境保持 `COOKIE_SECURE=0`；如配置 Caddy/Nginx HTTPS，设为 `1`。
- `.env` 权限 `600`，`data/` 权限 `700`，不要把数据库和备份放进代码仓库。
- 定期执行备份并异地保存；升级前必须备份。
- 生产只用 `npm run db:deploy`，不要用 `db:migrate`/`db:reset`。
- 单人维护场景建议至少保留两个管理员账号。
- 宽带账号密码当前以明文保存在数据库并随 Excel 导出，请限制数据库、备份和导出文件的访问权限。
- 通知 Word 副本保存在 `data/notifications/`（目录 `700`、文件 `600`）。它可能包含内部通知内容，备份、下载和恢复时按敏感文件管理；发送邮件前确认收件人。
