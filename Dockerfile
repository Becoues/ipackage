# ---------- 构建阶段 ----------
FROM node:22-slim AS build
WORKDIR /app

# 先拷 manifest，利用层缓存
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install

# 拷源码并构建（server -> dist，web -> web/dist）
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:22-slim
# openssh-client：用于 ssh 到远程机器；bash：远程命令用 bash -lc 包裹
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    IPACKAGE_DATA_DIR=/app/data

# 依赖与构建产物
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
# 示例配置作为兜底（实际配置通过卷挂载 /app/config）
COPY config/config.example.yaml ./config/config.example.yaml

EXPOSE 8787
# 单端口：后端 :8787 既提供 /api，也托管前端静态资源
CMD ["node", "server/dist/index.js"]
