import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SshHost } from "./types";

/**
 * ~/.ssh/config 路径。容器内 root 的 home 是 /root（compose 把宿主 ~/.ssh 挂到 /root/.ssh），
 * 用 os.homedir() 与现有 ssh 复用保持一致；可用 SSH_CONFIG_PATH 覆盖（测试 / 特殊部署）。
 */
function configPath(): string {
  return process.env.SSH_CONFIG_PATH || path.join(os.homedir(), ".ssh", "config");
}

function isPattern(alias: string): boolean {
  // 通配模式（Host *、bastion-?）不是具体机器，跳过
  return alias.includes("*") || alias.includes("?");
}

/**
 * 解析 ~/.ssh/config，返回可作为 ssh 目标的 Host 别名列表。
 * 只解析主配置文件（不展开 Include），逐行扫描 Host 块并捎带 HostName / User 供显示。
 */
export function discoverSshHosts(): SshHost[] {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath(), "utf8");
  } catch {
    return []; // 没有 config 文件就返回空
  }

  const hosts: SshHost[] = [];
  let current: SshHost[] = []; // 当前 Host 行可能声明多个别名

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === "host") {
      current = [];
      for (const alias of value.split(/\s+/)) {
        if (!alias || isPattern(alias) || alias.toLowerCase() === "local") continue;
        const h: SshHost = { host: alias };
        hosts.push(h);
        current.push(h);
      }
    } else if (key === "hostname") {
      for (const h of current) if (!h.hostName) h.hostName = value;
    } else if (key === "user") {
      for (const h of current) if (!h.user) h.user = value;
    }
  }

  // 同名别名去重（保留首次出现）
  const seen = new Set<string>();
  return hosts.filter((h) => {
    if (seen.has(h.host)) return false;
    seen.add(h.host);
    return true;
  });
}
