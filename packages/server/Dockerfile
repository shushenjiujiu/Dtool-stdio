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
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/

RUN pnpm install --no-frozen-lockfile

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

# 复制模板目录
COPY templates ./templates

# 复制 engine 产物
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder /app/packages/engine/package.json ./packages/engine/

# 复制 server 产物
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/

# 复制 node_modules（含 pnpm workspace symlink）
COPY --from=builder /app/node_modules ./node_modules

# 验证 engine 可解析
RUN node -e "require('@dtool-studio/engine')" && echo "✔ engine resolvable"

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3001/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
