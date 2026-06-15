import "dotenv/config";
import path from "node:path";
import express from "express";
import cors from "cors";
import type { Response } from "express";
import { loadConfig, usingExampleConfig } from "./config";
import { refresh, store, effectiveCommand } from "./checker";
import { buildChangelog } from "./changelog";
import { spawnOn, runOn } from "./ssh";
import { discoverSshHosts } from "./sshConfig";
import { saveMachines, savePackages } from "./overrides";
import type { Machine, PackageDef } from "./types";
import {
  publicSettings,
  saveSettings,
  loadSettings,
  effectiveApiKey,
  isMasked,
} from "./settings";

const PORT = Number(process.env.PORT || 8787);
// 原生跑默认只听 127.0.0.1（不暴露局域网）；容器里需 0.0.0.0 才能让 docker 端口映射生效，
// 由 Dockerfile 注入 HOST=0.0.0.0，并在 compose 用 127.0.0.1:8787:8787 把宿主侧限制为本机。
const HOST = process.env.HOST || "127.0.0.1";
const app = express();
app.use(cors());
app.use(express.json());

function findPackage(id: string): PackageDef | undefined {
  return loadConfig().packages.find((p) => p.id === id);
}

app.get("/api/config", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    machines: cfg.machines,
    packages: cfg.packages,
    usingExampleConfig: usingExampleConfig(),
    aiEnabled: !!effectiveApiKey(),
  });
});

// ---- 机器管理（持久化在 data/overrides.json）----
// 从 ~/.ssh/config 发现可用的 Host 别名，标注哪些已加入机器列表。
app.get("/api/ssh-hosts", (_req, res) => {
  try {
    const existing = new Set(loadConfig().machines.map((m) => m.host));
    const hosts = discoverSshHosts().map((h) => ({
      ...h,
      alreadyAdded: existing.has(h.host),
    }));
    res.json({ hosts });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 保存机器列表（整组覆盖）。保证 local 在列且启用。
app.post("/api/machines", (req, res) => {
  try {
    const input: Machine[] = Array.isArray(req.body?.machines)
      ? req.body.machines
      : [];
    const seen = new Set<string>();
    const machines: Machine[] = [];
    for (const m of input) {
      const host = typeof m?.host === "string" ? m.host.trim() : "";
      if (!host || seen.has(host)) continue;
      seen.add(host);
      machines.push({
        name: (m.name || host).toString().trim() || host,
        host,
        enabled: m.enabled !== false,
      });
    }
    if (!machines.some((m) => m.host === "local")) {
      machines.unshift({ name: "本机", host: "local", enabled: true });
    }
    saveMachines(machines);
    res.json({ machines: loadConfig().machines });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 保存包列表（整组覆盖）。校验关键字段与 manager 依赖。
app.post("/api/packages", (req, res) => {
  try {
    const input: PackageDef[] = Array.isArray(req.body?.packages)
      ? req.body.packages
      : [];
    const seen = new Set<string>();
    const packages: PackageDef[] = [];
    for (const p of input) {
      const id = typeof p?.id === "string" ? p.id.trim() : "";
      if (!id) throw new Error("包缺少 id");
      if (seen.has(id)) throw new Error(`包 id 重复：${id}`);
      if (!p.versionCommand?.trim()) throw new Error(`包 ${id} 缺少 versionCommand`);
      if (!p.updateCommand?.trim()) throw new Error(`包 ${id} 缺少 updateCommand`);
      const manager = (p.manager || "npm") as PackageDef["manager"];
      if (manager === "npm" && !p.npmName?.trim())
        throw new Error(`包 ${id}: manager=npm 需要 npmName`);
      if (manager === "pypi" && !p.pypiName?.trim())
        throw new Error(`包 ${id}: manager=pypi 需要 pypiName`);
      if (manager === "github" && !p.repo?.trim())
        throw new Error(`包 ${id}: manager=github 需要 repo`);
      seen.add(id);
      packages.push({
        id,
        label: (p.label || id).toString().trim() || id,
        manager,
        npmName: p.npmName?.trim() || undefined,
        pypiName: p.pypiName?.trim() || undefined,
        repo: p.repo?.trim() || undefined,
        versionCommand: p.versionCommand.trim(),
        versionRegex: p.versionRegex?.trim() || undefined,
        updateCommand: p.updateCommand.trim(),
        machineOverrides:
          p.machineOverrides && typeof p.machineOverrides === "object"
            ? p.machineOverrides
            : undefined,
      });
    }
    savePackages(packages);
    res.json({ packages: loadConfig().packages });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ---- AI / DeerAPI 设置（持久化在 data/settings.json）----
app.get("/api/settings", (_req, res) => {
  res.json(publicSettings());
});

app.post("/api/settings", (req, res) => {
  try {
    saveSettings(req.body || {});
    res.json(publicSettings());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post("/api/settings/test-connection", async (req, res) => {
  const body = req.body || {};
  const stored = loadSettings();
  const apiKey =
    typeof body.apiKey === "string" && body.apiKey && !isMasked(body.apiKey)
      ? body.apiKey.trim()
      : effectiveApiKey();
  const baseUrl = (body.baseUrl?.trim() || stored.baseUrl).replace(/\/$/, "");
  const model =
    (Array.isArray(body.models) && body.models[0]) || stored.models[0];
  if (!apiKey) return res.json({ ok: false, error: "未配置 API Key" });
  try {
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.json({ ok: false, error: `${r.status} ${t.slice(0, 200)}` });
    }
    res.json({ ok: true, model });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ cells: store.all() });
});

app.post("/api/refresh", async (req, res) => {
  try {
    const cfg = loadConfig();
    const { machineHosts, packageIds } = req.body || {};
    const cells = await refresh(cfg, { machineHosts, packageIds });
    res.json({ cells });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/changelog", async (req, res) => {
  try {
    const pkg = findPackage(String(req.query.pkg || ""));
    if (!pkg) return res.status(404).json({ error: "未知包" });
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const result = await buildChangelog(pkg, from, to);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- 流式更新（NDJSON：每行一个 JSON 对象）----
function writeLine(res: Response, obj: unknown) {
  res.write(JSON.stringify(obj) + "\n");
}

function streamUpdate(
  res: Response,
  host: string,
  pkg: PackageDef
): Promise<void> {
  return new Promise((resolve) => {
    const updateCommand = effectiveCommand(pkg, host, "updateCommand");
    writeLine(res, { type: "start", machine: host, packageId: pkg.id, command: updateCommand });
    const child = spawnOn(host, updateCommand);
    const timer = setTimeout(() => child.kill("SIGKILL"), 600000);
    child.stdout.on("data", (d) =>
      writeLine(res, { type: "log", stream: "out", text: d.toString() })
    );
    child.stderr.on("data", (d) =>
      writeLine(res, { type: "log", stream: "err", text: d.toString() })
    );
    child.on("error", (err) => {
      clearTimeout(timer);
      writeLine(res, { type: "log", stream: "err", text: String(err) });
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      // 更新后重新查一次该包版本
      let installed: string | null = null;
      try {
        const r = await runOn(host, effectiveCommand(pkg, host, "versionCommand"), 20000);
        const re = pkg.versionRegex ? new RegExp(pkg.versionRegex) : /(\d+\.\d+\.\d+[\w.-]*)/;
        const m = (r.stdout + "\n" + r.stderr).match(re);
        installed = m ? m[1] || m[0] : null;
      } catch {
        /* ignore */
      }
      if (installed) {
        const cell = store.get(host, pkg.id);
        cell.installed = installed;
        cell.status = cell.latest && installed >= cell.latest ? "uptodate" : cell.status;
        store.set(cell);
      }
      writeLine(res, { type: "done", machine: host, packageId: pkg.id, code, installed });
      resolve();
    });
  });
}

app.post("/api/update", async (req, res) => {
  const { machine, packageId } = req.body || {};
  const pkg = findPackage(packageId);
  if (!pkg) return res.status(404).json({ error: "未知包" });
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  await streamUpdate(res, machine, pkg);
  res.end();
});

app.post("/api/update-all", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const cfg = loadConfig();
  // 默认更新所有 outdated 的 cell；也可传 targets:[{machine,packageId}]
  let targets: { machine: string; packageId: string }[] = req.body?.targets;
  if (!targets || targets.length === 0) {
    targets = store
      .all()
      .filter((c) => c.status === "outdated")
      .map((c) => ({ machine: c.machine, packageId: c.packageId }));
  }
  writeLine(res, { type: "plan", count: targets.length, targets });
  for (const t of targets) {
    const pkg = findPackage(t.packageId);
    if (!pkg) continue;
    await streamUpdate(res, t.machine, pkg);
  }
  writeLine(res, { type: "all-done" });
  res.end();
});

// 生产模式下托管已构建的前端
const webDist = path.resolve(__dirname, "..", "..", "web", "dist");
app.use(express.static(webDist));

app.listen(PORT, HOST, () => {
  console.log(`ipackage server  ->  http://${HOST}:${PORT}`);
  if (usingExampleConfig()) {
    console.log("⚠️  正在使用 config.example.yaml，请复制为 config/config.yaml 后修改。");
  }
});
