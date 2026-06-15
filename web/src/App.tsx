import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getConfig,
  getStatus,
  refresh,
  getChangelog,
  streamUpdate,
} from "./api";
import type { Cell, ChangelogResp, ConfigResp, PackageDef } from "./types";
import SettingsModal from "./SettingsModal";
import MachinesModal from "./MachinesModal";
import PackagesModal from "./PackagesModal";

const STATUS_LABEL: Record<string, string> = {
  uptodate: "最新",
  outdated: "可更新",
  missing: "未安装",
  unknown: "未知",
  checking: "检查中",
};

interface LogLine {
  stream: "out" | "err" | "sys";
  text: string;
}

export default function App() {
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [showMachines, setShowMachines] = useState(false);
  const [showPackages, setShowPackages] = useState(false);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [drawer, setDrawer] = useState<{
    pkg: PackageDef;
    loading: boolean;
    data?: ChangelogResp;
    error?: string;
  } | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const topbarObs = useRef<ResizeObserver | null>(null);

  // 回调 ref：顶栏元素挂载时才测量（首帧 config 为 null 时顶栏还没渲染）。
  // 把顶栏真实高度写进 --topbar-h，下方矩阵区据此精确占满视口剩余高度。
  const setHeaderRef = useCallback((el: HTMLElement | null) => {
    topbarObs.current?.disconnect();
    if (!el) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--topbar-h",
        `${el.offsetHeight}px`
      );
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    topbarObs.current = ro;
  }, []);

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.machine}::${c.packageId}`, c);
    return m;
  }, [cells]);

  const outdatedCount = cells.filter((c) => c.status === "outdated").length;

  useEffect(() => {
    (async () => {
      try {
        const [cfg, st] = await Promise.all([getConfig(), getStatus()]);
        setConfig(cfg);
        setCells(st);
        if (st.length === 0) doRefresh(cfg);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function doRefresh(_cfg?: ConfigResp) {
    setRefreshing(true);
    setError("");
    try {
      const updated = await refresh();
      setCells(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  // 机器/包改动保存后：重载配置并重新检查矩阵
  async function onConfigChanged() {
    try {
      setConfig(await getConfig());
    } catch (e) {
      setError((e as Error).message);
    }
    doRefresh();
  }

  function pushLog(line: LogLine) {
    setLogs((prev) => [...prev, line]);
  }

  async function openChangelog(pkg: PackageDef) {
    setDrawer({ pkg, loading: true });
    // from = 各机器中最低的已安装版本；to = 最新版本
    const related = cells.filter((c) => c.packageId === pkg.id);
    const installedVers = related
      .map((c) => c.installed)
      .filter((v): v is string => !!v)
      .sort();
    const from = installedVers[0] || null;
    const latest = related.find((c) => c.latest)?.latest || null;
    try {
      const data = await getChangelog(pkg.id, from, latest);
      setDrawer({ pkg, loading: false, data });
    } catch (e) {
      setDrawer({ pkg, loading: false, error: (e as Error).message });
    }
  }

  async function updateOne(host: string, pkg: PackageDef) {
    if (!confirm(`在「${machineName(host)}」上执行：\n${pkg.updateCommand}\n确认更新？`))
      return;
    setConsoleOpen(true);
    setBusy(true);
    pushLog({ stream: "sys", text: `\n=== 更新 ${pkg.label} @ ${machineName(host)} ===` });
    try {
      await streamUpdate("/api/update", { machine: host, packageId: pkg.id }, onUpdateMsg);
    } catch (e) {
      pushLog({ stream: "err", text: String(e) });
    } finally {
      setBusy(false);
      doRefresh();
    }
  }

  async function updateAll() {
    if (outdatedCount === 0) return;
    if (!confirm(`将串行更新 ${outdatedCount} 个落后的包，确认？`)) return;
    setConsoleOpen(true);
    setBusy(true);
    pushLog({ stream: "sys", text: `\n=== 一键更新全部落后（${outdatedCount}）===` });
    try {
      await streamUpdate("/api/update-all", {}, onUpdateMsg);
    } catch (e) {
      pushLog({ stream: "err", text: String(e) });
    } finally {
      setBusy(false);
      doRefresh();
    }
  }

  function onUpdateMsg(msg: any) {
    if (msg.type === "start") {
      pushLog({ stream: "sys", text: `$ ${msg.command}` });
    } else if (msg.type === "log") {
      pushLog({ stream: msg.stream === "err" ? "err" : "out", text: msg.text });
    } else if (msg.type === "done") {
      pushLog({
        stream: msg.code === 0 ? "sys" : "err",
        text: `→ 退出码 ${msg.code}${msg.installed ? `，现版本 ${msg.installed}` : ""}`,
      });
    } else if (msg.type === "plan") {
      pushLog({ stream: "sys", text: `计划更新 ${msg.count} 项` });
    } else if (msg.type === "all-done") {
      pushLog({ stream: "sys", text: "=== 全部完成 ===" });
    }
  }

  function machineName(host: string) {
    return config?.machines.find((m) => m.host === host)?.name || host;
  }

  if (error && !config) {
    return <div className="fatal">加载失败：{error}</div>;
  }
  if (!config) return <div className="loading">加载中…</div>;

  const machines = config.machines.filter((m) => m.enabled !== false);

  return (
    <div className="app">
      <header className="topbar" ref={setHeaderRef}>
        <div className="brand">
          <span className="logo">📦</span> ipackage
          <span className="sub">多机包版本面板</span>
        </div>
        <div className="actions">
          {config.usingExampleConfig && (
            <span className="warn">使用示例配置，请创建 config/config.yaml</span>
          )}
          <span className="badge">{machines.length} 台机器</span>
          <span className="badge">{config.packages.length} 个包</span>
          <span className={`badge ${outdatedCount ? "badge-warn" : "badge-ok"}`}>
            {outdatedCount} 可更新
          </span>
          <span className={`badge ${config.aiEnabled ? "badge-ok" : ""}`}>
            AI {config.aiEnabled ? "✓" : "未配置"}
          </span>
          <button onClick={() => setShowMachines(true)} title="管理机器（从 SSH config 发现 / 勾选）">
            🖥️ 机器
          </button>
          <button onClick={() => setShowPackages(true)} title="管理 / 新增包">
            📦 包
          </button>
          <button onClick={() => setShowSettings(true)} title="AI / DeerAPI 设置">
            ⚙️ 设置
          </button>
          <button onClick={() => doRefresh()} disabled={refreshing}>
            {refreshing ? "刷新中…" : "↻ 刷新"}
          </button>
          <button
            className="primary"
            onClick={updateAll}
            disabled={busy || outdatedCount === 0}
          >
            ⬆ 一键更新全部
          </button>
        </div>
      </header>

      {error && <div className="errbar">{error}</div>}

      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="corner">包 \ 机器</th>
              {machines.map((m) => (
                <th key={m.host} title={m.host}>
                  {m.name}
                  <div className="host">{m.host}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.packages.map((pkg) => {
              const latest =
                cells.find((c) => c.packageId === pkg.id && c.latest)?.latest;
              return (
                <tr key={pkg.id}>
                  <th className="rowhead">
                    <button className="pkgname" onClick={() => openChangelog(pkg)}>
                      {pkg.label}
                    </button>
                    <div className="latest">
                      最新 {latest || "—"}
                      <span className="mgr">{pkg.manager}</span>
                    </div>
                  </th>
                  {machines.map((m) => {
                    const c = cellMap.get(`${m.host}::${pkg.id}`);
                    const status = c?.status || "unknown";
                    return (
                      <td key={m.host} className={`cell ${status}`}>
                        <div
                          className="cellinner"
                          title={c?.error || ""}
                          onClick={() =>
                            status === "outdated" || status === "missing"
                              ? updateOne(m.host, pkg)
                              : undefined
                          }
                          style={{
                            cursor:
                              status === "outdated" || status === "missing"
                                ? "pointer"
                                : "default",
                          }}
                        >
                          <div className="ver">{c?.installed || "—"}</div>
                          <div className="stat">{STATUS_LABEL[status]}</div>
                          {(status === "outdated" || status === "missing") && (
                            <div className="hint">点击更新 ⬆</div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* changelog 抽屉 */}
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>{drawer.pkg.label} · 更新内容</h3>
              <button onClick={() => setDrawer(null)}>✕</button>
            </div>
            <div className="drawer-body">
              {drawer.loading && <p>正在抓取并总结…</p>}
              {drawer.error && <p className="err">{drawer.error}</p>}
              {drawer.data && (
                <>
                  {drawer.data.note && <p className="note">{drawer.data.note}</p>}
                  {drawer.data.summary && (
                    <div className="summary">
                      {drawer.data.model && (
                        <div className="by-model">🤖 由 {drawer.data.model} 总结</div>
                      )}
                      <pre>{drawer.data.summary}</pre>
                    </div>
                  )}
                  <details open={!drawer.data.summary}>
                    <summary>原始 release（{drawer.data.releases.length}）</summary>
                    {drawer.data.releases.map((r) => (
                      <div className="release" key={r.tag}>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.name || r.tag}
                        </a>
                        <pre>{r.body}</pre>
                      </div>
                    ))}
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showMachines && (
        <MachinesModal
          initial={config.machines}
          onClose={() => setShowMachines(false)}
          onSaved={onConfigChanged}
        />
      )}

      {showPackages && (
        <PackagesModal
          initial={config.packages}
          onClose={() => setShowPackages(false)}
          onSaved={onConfigChanged}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            try {
              setConfig(await getConfig());
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      {/* 更新控制台 */}
      <div className={`console ${consoleOpen ? "open" : ""}`}>
        <div className="console-head" onClick={() => setConsoleOpen((v) => !v)}>
          <span>更新日志 {busy ? "· 运行中…" : ""}</span>
          <div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLogs([]);
              }}
            >
              清空
            </button>
            <button onClick={() => setConsoleOpen((v) => !v)}>
              {consoleOpen ? "▾" : "▴"}
            </button>
          </div>
        </div>
        {consoleOpen && (
          <pre className="console-body">
            {logs.map((l, i) => (
              <span key={i} className={`ln ${l.stream}`}>
                {l.text}
                {l.text.endsWith("\n") ? "" : "\n"}
              </span>
            ))}
            <div ref={logEndRef} />
          </pre>
        )}
      </div>
    </div>
  );
}
