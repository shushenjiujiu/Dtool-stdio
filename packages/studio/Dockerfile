# ============================================================
# dtool Studio — 前端 Dockerfile
# 构建上下文：monorepo 根目录
# 用法：docker build -f packages/studio/Dockerfile .
# ============================================================

# ── Stage 1: Build ──
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# 复制 monorepo 依赖声明和基础配置
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/studio/package.json packages/studio/

RUN pnpm install --no-frozen-lockfile

# 复制前端源码
COPY packages/studio/tsconfig.json packages/studio/
COPY packages/studio/vite.config.ts packages/studio/
COPY packages/studio/index.html packages/studio/
COPY packages/studio/src packages/studio/src/

# Vite build（不依赖 engine 类型）
RUN cd packages/studio && pnpm build

# ── Stage 2: Nginx ──
FROM nginx:alpine

RUN apk add --no-cache curl

# 复制 nginx 配置（从 monorepo 根下的 docker/ 目录）
COPY docker/nginx-frontend.conf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=builder /app/packages/studio/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=2 --start-period=5s \
  CMD wget -q --spider http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
