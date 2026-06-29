# ============================================================
# dtool Studio — 后端 Dockerfile
# 构建上下文：monorepo 根目录
# 用法：docker build -f packages/server/Dockerfile .
# ============================================================

# ── Stage 1: Build ──
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# 复制依赖声明
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile

# 复制源码
COPY packages/engine/src packages/engine/src/
COPY packages/engine/tsconfig.json packages/engine/
COPY packages/server/src packages/server/src/
COPY packages/server/tsconfig.json packages/server/

# 构建
RUN cd packages/engine && pnpm build
RUN cd /app/packages/server && pnpm build

# ── Stage 2: Runtime ──
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# 复制 monorepo 配置和包声明（用于 pnpm workspace 链接）
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/

# 复制构建产物
COPY --from=builder /app/packages/engine/dist packages/engine/dist
COPY --from=builder /app/packages/server/dist packages/server/dist

# 复制模块目录（system + official，只读）
COPY modules ./modules

# 安装生产依赖（自动建立 workspace symlink）
RUN pnpm install --prod --frozen-lockfile

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3001/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
