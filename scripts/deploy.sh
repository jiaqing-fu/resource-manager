#!/usr/bin/env bash
set -Eeuo pipefail

# 生产部署：安装依赖 → 备份 → 迁移 → 构建 →（可选）重启 systemd 服务。
# 用法：
#   bash scripts/deploy.sh                  # 只构建，不重启
#   RESTART=1 bash scripts/deploy.sh        # 构建后 sudo systemctl restart
#   SERVICE_NAME=resource-manager RESTART=1 bash scripts/deploy.sh

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

NODE_HOME="${NODE_HOME:-/home/lcadmin/APP/node-v24.15.0-linux-x64}"
if [[ -x "$NODE_HOME/bin/node" ]]; then
  export PATH="$NODE_HOME/bin:$PATH"
fi

SERVICE_NAME="${SERVICE_NAME:-resource-manager}"

echo "==> 项目目录：$APP_DIR"
echo "==> Node：$(node --version)，npm：$(npm --version)"

if [[ ! -f .env ]]; then
  echo "错误：缺少 .env，请先从 .env.example 复制并填写。" >&2
  exit 1
fi

secret="$(grep -E '^AUTH_SECRET=' .env | head -n1 | cut -d= -f2- | tr -d '"' || true)"
if [[ ${#secret} -lt 32 ]]; then
  echo "错误：AUTH_SECRET 缺失或少于 32 个字符，拒绝部署。" >&2
  exit 1
fi

echo "==> 安装依赖（npm ci，包含构建所需的 devDependencies）"
npm ci --include=dev

echo "==> 生成 Prisma Client"
npx prisma generate

mkdir -p data
chmod 700 data

if [[ -f data/app.db ]]; then
  echo "==> 迁移前备份"
  npm run backup
else
  echo "==> 未发现 data/app.db，跳过迁移前备份（首次部署）"
fi

echo "==> 应用数据库迁移（migrate deploy）"
npx prisma migrate deploy

echo "==> 构建生产版本"
npm run build

if [[ "${RESTART:-0}" == "1" ]]; then
  echo "==> 重启服务：$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  sudo systemctl --no-pager --lines=20 status "$SERVICE_NAME" || true
else
  echo "==> 构建完成。重启服务：sudo systemctl restart $SERVICE_NAME"
fi
