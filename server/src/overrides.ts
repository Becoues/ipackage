import fs from "node:fs";
import path from "node:path";
import type { Machine, PackageDef } from "./types";

// 与 settings.ts 一致的持久化目录（Docker data 命名卷）。
const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.IPACKAGE_DATA_DIR || path.join(ROOT, "data");
const OVERRIDES_PATH = path.join(DATA_DIR, "overrides.json");

/**
 * 网页里对机器/包的改动持久化在这里。config.yaml 仅作初始种子：
 * 某一类一旦被网页管理过（字段存在），就以这里为准，不再回退 yaml，也不改写 yaml。
 */
export interface Overrides {
  machines?: Machine[];
  packages?: PackageDef[];
}

export function loadOverrides(): Overrides {
  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, "utf8");
    const o = JSON.parse(raw) as Overrides;
    return {
      machines: Array.isArray(o.machines) ? o.machines : undefined,
      packages: Array.isArray(o.packages) ? o.packages : undefined,
    };
  } catch {
    return {};
  }
}

function write(o: Overrides) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(o, null, 2), "utf8");
}

export function saveMachines(machines: Machine[]): void {
  const cur = loadOverrides();
  write({ ...cur, machines });
}

export function savePackages(packages: PackageDef[]): void {
  const cur = loadOverrides();
  write({ ...cur, packages });
}
