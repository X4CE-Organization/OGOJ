# ---------------------------------------------------------------------------
# OGOJ - Oganesson Online Judge
#
# Single image that contains the API, the built frontend and the judge
# toolchains (C/C++, Python 3, Java, Node.js).
# ---------------------------------------------------------------------------

# ------------------------------- build stage -------------------------------
FROM node:22-bookworm AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# 跳过 optional 依赖（better-sqlite3 这类原生模块只在跑 SQLite 迁移时才需要），
# 构建更快、更省内存和磁盘
RUN npm ci --omit=optional

COPY . .
RUN npm run build

# ------------------------------ runtime stage ------------------------------
FROM node:22-bookworm-slim AS runtime

# 国内服务器可以把 APT 源换成镜像站加速构建：
#   docker compose build --build-arg APT_MIRROR=mirrors.aliyun.com
ARG APT_MIRROR=deb.debian.org

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    DATABASE_FILE=/app/data/ogoj.db

# Judge toolchains. Remove what you do not need to slim the image down.
# `time` is used for accurate peak-memory measurement.
RUN if [ "$APT_MIRROR" != "deb.debian.org" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      g++ gcc libc6-dev python3 time ca-certificates \
      postgresql-client \
      openjdk-17-jdk-headless \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --omit=optional --workspace @ogoj/server --include-workspace-root \
 && npm cache clean --force

COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Runtime data (database, testdata, uploads, backups) lives in a volume.
VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Create the schema, seed the default super administrator, then start serving.
CMD ["sh", "-c", "node apps/server/dist/db/migrate.js && node apps/server/dist/db/seed.js && node apps/server/dist/index.js"]
