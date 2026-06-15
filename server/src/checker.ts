import semver from "semver";
import type { AppConfig, Cell, Machine, PackageDef } from "./types";
import { runOn } from "./ssh";
import { fetchLatest } from "./registry";

const DEFAULT_REGEX = /(\d+\.\d+\.\d+[\w.-]*)/;

function cellKey(host: string, pkgId: string) {
  return `${host}::${pkgId}`;
}

class Store {
  private cells = new Map<string, Cell>();

  get(host: string, pkgId: string): Cell {
    const k = cellKey(host, pkgId);
    let c = this.cells.get(k);
    if (!c) {
      c = { machine: host, packageId: pkgId, installed: null, latest: null, status: "unknown" };
      this.cells.set(k, c);
    }
    return c;
  }

  set(c: Cell) {
    this.cells.set(cellKey(c.machine, c.packageId), c);
  }

  all(): Cell[] {
    return [...this.cells.values()];
  }
}

export const store = new Store();

/** 简单并发限制 */
async function pmap<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 解析某机器上该包应执行的命令：优先 machineOverrides[host]，否则用包级默认。 */
export function effectiveCommand(
  pkg: PackageDef,
  host: string,
  field: "versionCommand" | "updateCommand"
): string {
  return pkg.machineOverrides?.[host]?.[field] ?? pkg[field];
}

function parseInstalled(raw: string, pkg: PackageDef): string | null {
  const re = pkg.versionRegex ? new RegExp(pkg.versionRegex) : DEFAULT_REGEX;
  const m = raw.match(re);
  return m ? m[1] || m[0] : null;
}

function compare(installed: string | null, latest: string | null): Cell["status"] {
  if (!installed) return "missing";
  if (!latest) return "unknown";
  const ci = semver.coerce(installed);
  const cl = semver.coerce(latest);
  if (!ci || !cl) return "unknown";
  return semver.gte(ci, cl) ? "uptodate" : "outdated";
}

export interface RefreshOpts {
  machineHosts?: string[]; // 限定机器
  packageIds?: string[]; // 限定包
}

/** 跑一轮检查，更新 store。返回更新后的全部 cell。 */
export async function refresh(cfg: AppConfig, opts: RefreshOpts = {}): Promise<Cell[]> {
  const machines = cfg.machines.filter(
    (m) => m.enabled !== false && (!opts.machineHosts || opts.machineHosts.includes(m.host))
  );
  const packages = cfg.packages.filter(
    (p) => !opts.packageIds || opts.packageIds.includes(p.id)
  );

  // 1) 每个包查一次最新版本（并发）
  const latestMap = new Map<string, string | null>();
  await pmap(packages, 6, async (pkg) => {
    try {
      latestMap.set(pkg.id, await fetchLatest(pkg));
    } catch {
      latestMap.set(pkg.id, null);
    }
  });

  // 标记 checking
  for (const m of machines) {
    for (const pkg of packages) {
      const c = store.get(m.host, pkg.id);
      c.status = "checking";
      c.latest = latestMap.get(pkg.id) ?? null;
      store.set(c);
    }
  }

  // 2) 每台机器查每个包的已安装版本（机器内串行，机器间并发）
  await pmap(machines, 5, async (m: Machine) => {
    for (const pkg of packages) {
      const latest = latestMap.get(pkg.id) ?? null;
      const cell: Cell = {
        machine: m.host,
        packageId: pkg.id,
        installed: null,
        latest,
        status: "checking",
        checkedAt: new Date().toISOString(),
      };
      try {
        const r = await runOn(m.host, effectiveCommand(pkg, m.host, "versionCommand"), 20000);
        if (r.timedOut) {
          cell.status = "unknown";
          cell.error = "查询超时";
        } else if (r.code !== 0 && !r.stdout.trim()) {
          // 命令失败且无输出 => 视为未安装
          cell.installed = null;
          cell.status = "missing";
          cell.error = r.stderr.trim().slice(0, 200) || `exit ${r.code}`;
        } else {
          cell.installed = parseInstalled(r.stdout + "\n" + r.stderr, pkg);
          cell.status = compare(cell.installed, latest);
          if (!cell.installed) cell.error = "无法从输出解析版本号";
        }
      } catch (e) {
        cell.status = "unknown";
        cell.error = (e as Error).message.slice(0, 200);
      }
      store.set(cell);
    }
  });

  return store.all();
}
