import type {
  Cell,
  ChangelogResp,
  ConfigResp,
  Machine,
  PackageDef,
  SettingsResp,
  SshHost,
  TestConnResp,
} from "./types";

export async function getConfig(): Promise<ConfigResp> {
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error("加载配置失败");
  return r.json();
}

export async function getStatus(): Promise<Cell[]> {
  const r = await fetch("/api/status");
  const d = await r.json();
  return d.cells || [];
}

export async function refresh(body?: {
  machineHosts?: string[];
  packageIds?: string[];
}): Promise<Cell[]> {
  const r = await fetch("/api/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "刷新失败");
  }
  const d = await r.json();
  return d.cells || [];
}

export async function getChangelog(
  pkg: string,
  from: string | null,
  to: string | null
): Promise<ChangelogResp> {
  const q = new URLSearchParams({ pkg });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const r = await fetch(`/api/changelog?${q.toString()}`);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "获取 changelog 失败");
  }
  return r.json();
}

export async function getSshHosts(): Promise<SshHost[]> {
  const r = await fetch("/api/ssh-hosts");
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "读取 SSH config 失败");
  }
  const d = await r.json();
  return d.hosts || [];
}

export async function saveMachines(machines: Machine[]): Promise<Machine[]> {
  const r = await fetch("/api/machines", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machines }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "保存机器失败");
  }
  const d = await r.json();
  return d.machines || [];
}

export async function savePackages(packages: PackageDef[]): Promise<PackageDef[]> {
  const r = await fetch("/api/packages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ packages }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "保存包失败");
  }
  const d = await r.json();
  return d.packages || [];
}

export async function getSettings(): Promise<SettingsResp> {
  const r = await fetch("/api/settings");
  if (!r.ok) throw new Error("加载设置失败");
  return r.json();
}

export async function saveSettings(body: {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
}): Promise<SettingsResp> {
  const r = await fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "保存失败");
  }
  return r.json();
}

export async function testConnection(body: {
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
}): Promise<TestConnResp> {
  const r = await fetch("/api/settings/test-connection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

/** 流式更新：逐行回调 NDJSON 对象 */
export async function streamUpdate(
  path: "/api/update" | "/api/update-all",
  body: any,
  onMsg: (msg: any) => void
): Promise<void> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.body) throw new Error("无响应流");
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onMsg(JSON.parse(line));
        } catch {
          /* ignore partial */
        }
      }
    }
  }
}
