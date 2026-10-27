import path from "node:path";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

// 固定读仓库根目录的 .env。`npm -w server run dev` 时 cwd 是 server/，
// dotenv 默认按 cwd 找，会漏掉根目录 .env（GITHUB_TOKEN 读不到 => 私有仓库查不到最新版）。
// 已存在的环境变量（如 docker compose 注入的）优先，不会被覆盖。
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

// Mac App 等场景下配置目录不在仓库里：再读一份配置目录下的 .env（同样不覆盖已有变量）。
if (process.env.IPACKAGE_CONFIG_DIR) {
  dotenv.config({ path: path.join(process.env.IPACKAGE_CONFIG_DIR, ".env") });
}

// 仍没有 GITHUB_TOKEN 时，尝试复用 gh CLI 的登录态（`gh auth token`）。
// 走登录 shell 以拿到完整 PATH（gh 通常在 /opt/homebrew/bin）；短超时，失败静默忽略。
if (!process.env.GITHUB_TOKEN) {
  try {
    const token = execFileSync("/bin/bash", ["-lc", "gh auth token"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
    }).trim();
    if (token) process.env.GITHUB_TOKEN = token;
  } catch {
    // 没装 gh / 未登录 / 超时：保持无 token，公开仓库照常可查
  }
}
