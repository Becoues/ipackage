import semver from "semver";
import type { PackageDef } from "./types";
import { cleanTag } from "./registry";
import { loadSettings, effectiveApiKey } from "./settings";

const UA = { "User-Agent": "ipackage/0.1 (+local dashboard)" };

interface ReleaseNote {
  tag: string;
  name: string;
  body: string;
  url: string;
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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 单次 DeerAPI(OpenAI 兼容) chat/completions 调用。 */
async function chatComplete(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content:
            "你是发布说明分析助手，用简体中文输出精炼的 markdown 要点。",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new HttpError(res.status, `${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  return data.choices?.[0]?.message?.content || "";
}

/** 按降级链依次尝试，返回首个成功的结果与所用模型。 */
async function summarizeWithFallback(
  prompt: string
): Promise<{ text: string; model: string; tried: string[] }> {
  const apiKey = effectiveApiKey();
  const { baseUrl, models } = loadSettings();
  const tried: string[] = [];
  let lastErr: unknown;
  for (const model of models) {
    tried.push(model);
    try {
      const text = await chatComplete(baseUrl, apiKey, model, prompt);
      if (text.trim()) return { text, model, tried };
      lastErr = new Error(`${model} 返回空内容`);
    } catch (e) {
      lastErr = e;
      // 鉴权失败：换模型也没用，直接抛出
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        throw e;
      }
      // 其它错误（404 模型不存在 / 429 限流 / 5xx）继续降级
    }
  }
  throw lastErr || new Error("所有模型均失败");
}

function buildPrompt(
  label: string,
  from: string | null,
  to: string | null,
  raw: string
): string {
  return `下面是 ${label} 从 ${from || "?"} 升级到 ${
    to || "最新"
  } 之间的 GitHub release notes 原文。请用简体中文总结，分这几个小节（没有的省略）：

## ✨ 新功能
## ⚠️ 破坏性变更 / 需注意
## 🐛 修复
## 📦 其他

最后用一句话给出「是否建议升级」的判断。保持精炼，用要点列表。

原文：
${raw.slice(0, 24000)}`;
}

export interface ChangelogResult {
  summary: string;
  aiEnabled: boolean;
  model?: string; // 实际产出总结的模型
  releases: ReleaseNote[];
  note?: string;
}

export async function buildChangelog(
  pkg: PackageDef,
  from: string | null,
  to: string | null
): Promise<ChangelogResult> {
  if (!pkg.repo) {
    return {
      summary: "",
      aiEnabled: false,
      releases: [],
      note: `包 ${pkg.label} 未配置 repo，无法抓取 changelog。`,
    };
  }
  const all = await fetchReleases(pkg.repo);
  let releases = inRange(all, from, to);
  if (releases.length === 0) releases = all.slice(0, 5);
  const raw = releases
    .map((r) => `### ${r.name} (${r.tag})\n${r.body}`)
    .join("\n\n---\n\n");

  const aiEnabled = !!effectiveApiKey();
  let summary = "";
  let model: string | undefined;
  let note: string | undefined;
  if (aiEnabled) {
    try {
      const r = await summarizeWithFallback(buildPrompt(pkg.label, from, to, raw));
      summary = r.text;
      model = r.model;
    } catch (e) {
      note = `AI 总结失败：${(e as Error).message}。已展示原文。`;
    }
  } else {
    note = "未配置 DeerAPI Key（点右上角设置），仅展示 release 原文。";
  }
  return { summary, aiEnabled, model, releases, note };
}
