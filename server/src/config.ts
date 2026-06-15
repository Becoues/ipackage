import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { AppConfig, Machine, PackageDef } from "./types";
import { loadOverrides } from "./overrides";

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT, "config", "config.yaml");
const EXAMPLE_PATH = path.join(ROOT, "config", "config.example.yaml");

const LOCAL: Machine = { name: "本机", host: "local", enabled: true };

function validate(cfg: AppConfig): AppConfig {
  if (!cfg || !Array.isArray(cfg.machines) || !Array.isArray(cfg.packages)) {
    throw new Error("config.yaml 缺少 machines 或 packages 数组");
  }
  const machines: Machine[] = cfg.machines
    .filter((m) => m && m.host)
    .map((m) => ({ enabled: true, ...m }));

  const packages: PackageDef[] = cfg.packages.map((p, i) => {
    if (!p.id) throw new Error(`packages[${i}] 缺少 id`);
    if (!p.versionCommand) throw new Error(`package ${p.id} 缺少 versionCommand`);
    if (!p.updateCommand) throw new Error(`package ${p.id} 缺少 updateCommand`);
    return p;
  });
  return { machines, packages };
}

/** 读 config.yaml（不存在则用 example），严格校验。这是初始种子。 */
export function loadBaseConfig(): AppConfig {
  const file = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_PATH;
  const raw = fs.readFileSync(file, "utf8");
  const parsed = YAML.parse(raw) as AppConfig;
  return validate(parsed);
}

/** override 来的机器宽松规范化：丢掉缺 host 的，保证有 enabled，标记来源。 */
function normalizeMachines(list: Machine[]): Machine[] {
  return list
    .filter((m) => m && typeof m.host === "string" && m.host.trim())
    .map((m) => ({
      name: m.name || m.host,
      host: m.host,
      enabled: m.enabled !== false,
      source: "ui" as const,
    }));
}

/** override 来的包宽松规范化：丢掉缺关键字段的，避免整页崩。 */
function normalizePackages(list: PackageDef[]): PackageDef[] {
  return list
    .filter((p) => p && p.id && p.versionCommand && p.updateCommand)
    .map((p) => ({ ...p, source: "ui" as const }));
}

/** 保证 local 机器存在且置顶、启用。 */
function withLocal(machines: Machine[]): Machine[] {
  const rest = machines.filter((m) => m.host !== "local");
  const local = machines.find((m) => m.host === "local");
  return [{ ...LOCAL, ...local, host: "local", enabled: true }, ...rest];
}

/**
 * 有效配置 = override 优先、否则 yaml 种子。
 * 机器/包各自独立：哪一类被网页管理过就用 override，另一类仍可来自 yaml。
 */
export function loadConfig(): AppConfig {
  const base = loadBaseConfig();
  const ov = loadOverrides();

  const machines = ov.machines
    ? normalizeMachines(ov.machines)
    : base.machines.map((m) => ({ ...m, source: "config" as const }));

  const packages = ov.packages
    ? normalizePackages(ov.packages)
    : base.packages.map((p) => ({ ...p, source: "config" as const }));

  return { machines: withLocal(machines), packages };
}

export function usingExampleConfig(): boolean {
  return !fs.existsSync(CONFIG_PATH);
}
