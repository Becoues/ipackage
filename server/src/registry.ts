import type { PackageDef } from "./types";

const UA = { "User-Agent": "ipackage/0.1 (+local dashboard)" };

async function getJson(url: string): Promise<any> {
  const headers: Record<string, string> = { ...UA, Accept: "application/json" };
  if (url.includes("api.github.com") && process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    // 私有仓库无 token 时 GitHub 返回 404 而不是 401，容易误判成“没有 release”
    const hint =
      res.status === 404 && url.includes("api.github.com") && !process.env.GITHUB_TOKEN
        ? "（私有仓库需配置 GITHUB_TOKEN）"
        : "";
    throw new Error(`${res.status} ${res.statusText} @ ${url}${hint}`);
  }
  return res.json();
}

export function cleanTag(tag: string): string {
  return tag.replace(/^v/i, "").trim();
}

/** 查包的最新版本号。失败抛错由上层捕获记为 unknown。 */
export async function fetchLatest(pkg: PackageDef): Promise<string> {
  switch (pkg.manager) {
    case "npm": {
      const name = pkg.npmName;
      if (!name) throw new Error(`${pkg.id}: manager=npm 但缺 npmName`);
      const data = await getJson(
        `https://registry.npmjs.org/${encodeURIComponent(name).replace(
          "%40",
          "@"
        )}/latest`
      );
      return data.version;
    }
    case "pypi": {
      const name = pkg.pypiName;
      if (!name) throw new Error(`${pkg.id}: manager=pypi 但缺 pypiName`);
      const data = await getJson(`https://pypi.org/pypi/${name}/json`);
      return data.info.version;
    }
    case "github": {
      if (!pkg.repo) throw new Error(`${pkg.id}: manager=github 但缺 repo`);
      const data = await getJson(
        `https://api.github.com/repos/${pkg.repo}/releases/latest`
      );
      return cleanTag(data.tag_name);
    }
    case "custom":
    default:
      // custom：优先用 repo 的 github release 兜底
      if (pkg.repo) {
        const data = await getJson(
          `https://api.github.com/repos/${pkg.repo}/releases/latest`
        );
        return cleanTag(data.tag_name);
      }
      throw new Error(`${pkg.id}: manager=custom 需要 repo 才能查最新版`);
  }
}
