import semver from "semver";
import type { PackageDef } from "./types";
import { cleanTag } from "./registry";

const UA = { "User-Agent": "ipackage/0.1 (+local dashboard)" };

interface ReleaseNote {
  tag: string;
  name: string;
  body: string;
  url: string;
  date?: string; // published_at
}

async function fetchReleases(repo: string): Promise<ReleaseNote[]> {
  const headers: Record<string, string> = { ...UA, Accept: "application/json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
    { headers }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status} ${res.statusText}`);
  const data = (await res.json()) as any[];
  return data.map((r) => ({
    tag: cleanTag(r.tag_name || ""),
    name: r.name || r.tag_name || "",
    body: r.body || "",
    url: r.html_url || "",
    date: r.published_at || undefined,
  }));
}

/** 取 (from, to] 区间内的 release 笔记，from/to 为版本号字符串。 */
function inRange(notes: ReleaseNote[], from: string | null, to: string | null) {
  return notes
    .filter((n) => semver.valid(semver.coerce(n.tag)))
    .filter((n) => {
      const v = semver.coerce(n.tag)!;
      const okTo = !to || semver.lte(v, semver.coerce(to)!);
      const okFrom = !from || semver.gt(v, semver.coerce(from)!);
      return okTo && okFrom;
    })
    .sort((a, b) =>
      semver.rcompare(semver.coerce(a.tag)!, semver.coerce(b.tag)!)
    );
}

export interface ChangelogResult {
  releases: ReleaseNote[];
  inRange: boolean; // false = 区间内没匹配到，退化为最近 5 个 release
  note?: string;
}

/** 抓 (from, to] 区间内的 GitHub release 原文。 */
export async function buildChangelog(
  pkg: PackageDef,
  from: string | null,
  to: string | null
): Promise<ChangelogResult> {
  if (!pkg.repo) {
    return {
      releases: [],
      inRange: false,
      note: `包 ${pkg.label} 未配置 repo，无法抓取 changelog。`,
    };
  }
  const all = await fetchReleases(pkg.repo);
  const releases = inRange(all, from, to);
  if (releases.length > 0) return { releases, inRange: true };
  return {
    releases: all.slice(0, 5),
    inRange: false,
    note: all.length ? "区间内没有匹配的 release，展示最近 5 个。" : "该仓库没有 release。",
  };
}
