import type { Cell, CellStatus, PackageDef } from "./types";

export const STATUS_LABEL: Record<CellStatus, string> = {
  uptodate: "最新",
  outdated: "可更新",
  missing: "未安装",
  unknown: "异常",
  checking: "检查中",
};

/** 可以点击执行更新/安装的状态 */
export const isActionable = (s: CellStatus) => s === "outdated" || s === "missing";

/** 需要关注的状态（侧栏「需处理」过滤） */
export const isProblem = (s: CellStatus) => s === "missing" || s === "unknown";

export const cellKey = (host: string, pkgId: string) => `${host}::${pkgId}`;

/** 与后端一致：优先 machineOverrides[host]，否则包级默认。确认框里展示真正会执行的命令。 */
export function effectiveCommand(
  pkg: PackageDef,
  host: string,
  field: "versionCommand" | "updateCommand"
): string {
  return pkg.machineOverrides?.[host]?.[field] ?? pkg[field];
}

/** 按数字段比较版本号（0.0.9 < 0.0.18），字符串排序会排错。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.match(/\d+/g)?.map(Number) || [];
  const pb = b.match(/\d+/g)?.map(Number) || [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 某包：各机器最低的已安装版本 + 最新版本，用于 changelog 区间 */
export function versionRange(cells: Cell[], pkgId: string) {
  const related = cells.filter((c) => c.packageId === pkgId);
  const installed = related
    .map((c) => c.installed)
    .filter((v): v is string => !!v)
    .sort(compareVersions);
  return {
    from: installed[0] || null,
    latest: related.find((c) => c.latest)?.latest || null,
  };
}

export function formatTime(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
}

/** 由 id 稳定散列出色相，给包头像上色 */
export function hueOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** 头像字母：多词取首字母（Claude Code CLI → CC），单词取前两位 */
export function initials(label: string): string {
  const words = label.replace(/\b(CLI|cli)\b/g, "").trim().split(/[\s\-_]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || label;
  return (w[0].toUpperCase() + (w[1] || "")).slice(0, 2);
}

export interface StatusCounts {
  uptodate: number;
  outdated: number;
  missing: number;
  unknown: number;
  checking: number;
  total: number;
}

export function countStatuses(cells: (Cell | undefined)[]): StatusCounts {
  const r: StatusCounts = { uptodate: 0, outdated: 0, missing: 0, unknown: 0, checking: 0, total: 0 };
  for (const c of cells) {
    r[c?.status || "unknown"]++;
    r.total++;
  }
  return r;
}
