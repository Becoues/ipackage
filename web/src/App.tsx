import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConfig, getStatus, refresh, streamUpdate } from "./api";
import type { Cell, ConfigResp, PackageDef, UpdateMsg } from "./types";
import { cellKey, countStatuses, effectiveCommand, isProblem, versionRange } from "./lib";
import { Icon } from "./icons";
import Sidebar, { type StatusFilter } from "./Sidebar";
import PackageGrid, { type ViewProps } from "./PackageGrid";
import Matrix from "./Matrix";
import ChangelogDrawer from "./ChangelogDrawer";
import ActivityPanel, { type LogLine } from "./ActivityPanel";
import MachinesModal from "./MachinesModal";
import PackagesModal from "./PackagesModal";
import { useConfirm, useToasts } from "./feedback";

type Target = { machine: string; packageId: string };
type Scope = { machineHosts?: string[]; packageIds?: string[] };
type View = "cards" | "matrix";

const FILTER_TITLE: Record<StatusFilter, string> = {
  all: "全部包",
  outdated: "可更新",
  problem: "需处理",
};

export default function App() {
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]); // 进行中的刷新（可并发局部刷新）
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"machines" | "packages" | null>(null);
  const [changelogPkg, setChangelogPkg] = useState<PackageDef | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [machineFilter, setMachineFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(() => (localStorage.getItem("ipackage.view") as View) || "cards");
  const searchRef = useRef<HTMLInputElement>(null);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [confirm, confirmNode] = useConfirm();
  const [toast, toastNode] = useToasts();

  useEffect(() => localStorage.setItem("ipackage.view", view), [view]);

  // 「/」或 ⌘K 聚焦搜索
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
      if ((e.key === "/" && !typing) || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(cellKey(c.machine, c.packageId), c);
    return m;
  }, [cells]);

  const machines = useMemo(() => config?.machines.filter((m) => m.enabled !== false) ?? [], [config]);
  const packages = config?.packages ?? [];

  // 当前展示中的 机器 × 包（被停用/删除的机器在 store 里的残留 cell 不计入）
  const visibleCells = useMemo(
    () => machines.flatMap((m) => packages.map((p) => cellMap.get(cellKey(m.host, p.id)))),
    [machines, packages, cellMap]
  );
  const totals = countStatuses(visibleCells);
  const outdated = visibleCells.filter((c): c is Cell => c?.status === "outdated");
  const lastChecked = visibleCells.reduce<string | undefined>(
    (max, c) => (c?.checkedAt && (!max || c.checkedAt > max) ? c.checkedAt : max),
    undefined
  );

  // 过滤：机器（侧栏）× 状态（侧栏）× 搜索
  const shownMachines = machineFilter ? machines.filter((m) => m.host === machineFilter) : machines;
  const shownPackages = packages.filter((pkg) => {
    const q = query.trim().toLowerCase();
    if (q && ![pkg.label, pkg.id, pkg.npmName, pkg.pypiName, pkg.repo].some((s) => s?.toLowerCase().includes(q)))
      return false;
    if (statusFilter === "all") return true;
    return shownMachines.some((m) => {
      const s = cellMap.get(cellKey(m.host, pkg.id))?.status;
      return s && (statusFilter === "outdated" ? s === "outdated" : isProblem(s));
    });
  });

  const refreshingHosts = new Set(scopes.flatMap((s) => (s.packageIds ? [] : s.machineHosts ?? machines.map((m) => m.host))));
  const refreshingPkgs = new Set(scopes.flatMap((s) => (s.machineHosts ? [] : s.packageIds ?? packages.map((p) => p.id))));
  const refreshingAll = scopes.some((s) => !s.machineHosts && !s.packageIds);

  // 标签页 / Dock 标题带上可更新数量
  useEffect(() => {
    document.title = `${outdated.length ? `(${outdated.length}) ` : ""}ipackage`;
  }, [outdated.length]);

  /** 刷新（可限定机器/包）；请求期间先把对应格子标成「检查中」 */
  const doRefresh = useCallback(async (scope: Scope = {}) => {
    const inScope = (c: Cell) =>
      (!scope.machineHosts || scope.machineHosts.includes(c.machine)) &&
      (!scope.packageIds || scope.packageIds.includes(c.packageId));
    setCells((cs) => cs.map((c) => (inScope(c) ? { ...c, status: "checking" } : c)));
    setScopes((s) => [...s, scope]);
    setError("");
    try {
      setCells(await refresh(scope));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScopes((s) => s.filter((x) => x !== scope));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, st] = await Promise.all([getConfig(), getStatus()]);
        setConfig(cfg);
        setCells(st);
        if (st.length === 0) doRefresh();
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [doRefresh]);

  // 机器/包改动保存后：重载配置并重新检查
  async function onConfigChanged() {
    try {
      setConfig(await getConfig());
    } catch (e) {
      setError((e as Error).message);
    }
    doRefresh();
  }

  const pushLog = (line: LogLine) => setLogs((prev) => [...prev, line]);
  const machineName = (host: string) => config?.machines.find((m) => m.host === host)?.name || host;
  const pkgLabel = (id: string) => config?.packages.find((p) => p.id === id)?.label || id;

  function onUpdateMsg(msg: UpdateMsg) {
    switch (msg.type) {
      case "plan":
        pushLog({ stream: "sys", text: `计划更新 ${msg.count} 项` });
        break;
      case "start":
        setActiveKey(cellKey(msg.machine, msg.packageId));
        pushLog({
          stream: "sys",
          text: `\n▶ ${pkgLabel(msg.packageId)} @ ${machineName(msg.machine)}\n$ ${msg.command}`,
        });
        break;
      case "log":
        pushLog({ stream: msg.stream === "err" ? "err" : "out", text: msg.text });
        break;
      case "done": {
        setActiveKey(null);
        const name = `${pkgLabel(msg.packageId)} @ ${machineName(msg.machine)}`;
        pushLog({
          stream: msg.code === 0 ? "sys" : "err",
          text: `→ 退出码 ${msg.code}${msg.installed ? `，现版本 ${msg.installed}` : ""}`,
        });
        if (msg.code === 0) toast("ok", `${name} 已更新${msg.installed ? `到 ${msg.installed}` : ""}`);
        else toast("err", `${name} 更新失败（退出码 ${msg.code}），详见日志`);
        break;
      }
      case "all-done":
        pushLog({ stream: "sys", text: "=== 全部完成 ===" });
        break;
    }
  }

  /** 串行执行一组更新，结束后只刷新涉及的包 */
  async function runUpdates(targets: Target[], title: string) {
    if (targets.length === 0 || busy) return;
    setActivityOpen(true);
    setBusy(true);
    pushLog({ stream: "sys", text: `\n=== ${title} ===` });
    try {
      if (targets.length === 1) await streamUpdate("/api/update", targets[0], onUpdateMsg);
      else await streamUpdate("/api/update-all", { targets }, onUpdateMsg);
    } catch (e) {
      pushLog({ stream: "err", text: String(e) });
      toast("err", String(e));
    } finally {
      setBusy(false);
      setActiveKey(null);
      doRefresh({ packageIds: [...new Set(targets.map((t) => t.packageId))] });
    }
  }

  async function updateCell(host: string, pkg: PackageDef) {
    const c = cellMap.get(cellKey(host, pkg.id));
    const verb = c?.status === "missing" ? "安装" : "更新";
    const ok = await confirm({
      title: `${verb} ${pkg.label}`,
      message: (
        <>
          将在 <b>{machineName(host)}</b> 上执行以下命令
          {c?.installed && c.latest && (
            <>
              ，{c.installed} → <b>{c.latest}</b>
            </>
          )}
          ：
        </>
      ),
      command: effectiveCommand(pkg, host, "updateCommand"),
      confirmText: verb,
    });
    if (ok) runUpdates([{ machine: host, packageId: pkg.id }], `${pkg.label} @ ${machineName(host)}`);
  }

  async function updateRow(pkg: PackageDef) {
    const targets = outdated.filter((c) => c.packageId === pkg.id).map((c) => ({ machine: c.machine, packageId: c.packageId }));
    const ok = await confirm({
      title: `更新 ${pkg.label}`,
      message: `将依次在 ${targets.map((t) => machineName(t.machine)).join("、")} 上更新到最新版本。`,
      confirmText: `更新 ${targets.length} 台`,
    });
    if (ok) runUpdates(targets, `更新 ${pkg.label}（${targets.length} 台）`);
  }

  async function updateAll() {
    const ok = await confirm({
      title: "一键更新全部",
      message: (
        <ul className="confirm-list">
          {outdated.map((c) => (
            <li key={cellKey(c.machine, c.packageId)}>
              <b>{pkgLabel(c.packageId)}</b> @ {machineName(c.machine)}
              <span>
                {c.installed} → {c.latest}
              </span>
            </li>
          ))}
        </ul>
      ),
      confirmText: `串行更新 ${outdated.length} 项`,
    });
    if (ok) runUpdates(outdated.map((c) => ({ machine: c.machine, packageId: c.packageId })), `一键更新全部（${outdated.length}）`);
  }

  if (error && !config) {
    return (
      <div className="splash">
        <Icon name="alert" size={28} />
        <p>加载失败：{error}</p>
        <button onClick={() => location.reload()}>重试</button>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="splash">
        <Icon name="refresh" size={24} className="spin" />
      </div>
    );
  }

  const range = changelogPkg ? versionRange(cells, changelogPkg.id) : null;
  const settled = totals.total - totals.checking;
  const health = settled ? Math.round((totals.uptodate / settled) * 100) : 0;
  const title = machineFilter ? machineName(machineFilter) : FILTER_TITLE[statusFilter];

  const viewProps: ViewProps = {
    machines: shownMachines,
    packages: shownPackages,
    cellMap,
    busy,
    activeKey,
    refreshingPkgs,
    onOpenChangelog: setChangelogPkg,
    onUpdateCell: updateCell,
    onUpdateRow: updateRow,
    onRefreshRow: (pkg) => doRefresh({ packageIds: [pkg.id] }),
  };

  return (
    <div className="shell">
      <Sidebar
        machines={machines}
        packages={packages}
        cellMap={cellMap}
        statusFilter={statusFilter}
        machineFilter={machineFilter}
        refreshingHosts={refreshingHosts}
        lastChecked={lastChecked}
        onStatusFilter={setStatusFilter}
        onMachineFilter={setMachineFilter}
        onRefreshMachine={(host) => doRefresh({ machineHosts: [host] })}
        onManageMachines={() => setModal("machines")}
        onManagePackages={() => setModal("packages")}
      />

      <main className="main">
        <header className="toolbar drag">
          <h1>{title}</h1>
          <div className="toolbar-actions">
            <label className="search">
              <Icon name="search" size={15} />
              <input
                ref={searchRef}
                value={query}
                placeholder="搜索包"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
              />
              {!query && <kbd>/</kbd>}
            </label>
            <div className="segmented">
              <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")} title="卡片视图">
                <Icon name="grid" size={15} />
              </button>
              <button className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")} title="矩阵视图">
                <Icon name="table" size={15} />
              </button>
            </div>
            <button className="btn-icon btn-bordered" onClick={() => doRefresh()} disabled={refreshingAll} title="刷新全部">
              <Icon name="refresh" className={refreshingAll ? "spin" : ""} />
            </button>
            <button className="primary" onClick={updateAll} disabled={busy || outdated.length === 0}>
              <Icon name="upCircle" />
              全部更新
              {outdated.length > 0 && <span className="btn-badge">{outdated.length}</span>}
            </button>
          </div>
        </header>

        <div className="content">
          {config.usingExampleConfig && (
            <div className="notice">当前使用示例配置，复制 config.example.yaml 为 config.yaml 后按需修改。</div>
          )}
          {error && <div className="notice notice-err">{error}</div>}

          <section className="hero">
            <div className="ring" style={{ ["--p" as string]: health }}>
              <span>{totals.checking === totals.total && totals.total ? "…" : `${health}%`}</span>
            </div>
            <div className="hero-text">
              <h2>
                {totals.checking > 0
                  ? "正在检查…"
                  : outdated.length
                    ? `${outdated.length} 项可以更新`
                    : totals.missing + totals.unknown
                      ? "已更新到最新，有几项需要处理"
                      : "一切都是最新的"}
              </h2>
              <p>
                {machines.length} 台机器 · {packages.length} 个包 · 共 {totals.total} 处安装
              </p>
            </div>
            <div className="hero-stats">
              <Stat label="最新" value={totals.uptodate} tone="ok" />
              <Stat label="可更新" value={totals.outdated} tone="warn" onClick={() => setStatusFilter("outdated")} />
              <Stat label="未安装" value={totals.missing} tone="muted" onClick={() => setStatusFilter("problem")} />
              <Stat label="异常" value={totals.unknown} tone="bad" onClick={() => setStatusFilter("problem")} />
            </div>
          </section>

          {shownPackages.length === 0 ? (
            <div className="empty">
              <Icon name="checkCircle" size={36} />
              <h3>{query ? `没有匹配「${query}」的包` : statusFilter === "outdated" ? "没有需要更新的包" : "这里没有需要处理的项"}</h3>
              <button
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setMachineFilter(null);
                }}
              >
                查看全部包
              </button>
            </div>
          ) : view === "cards" ? (
            <PackageGrid {...viewProps} />
          ) : (
            <Matrix {...viewProps} />
          )}
        </div>
      </main>

      <ActivityPanel
        logs={logs}
        open={activityOpen}
        busy={busy}
        onToggle={() => setActivityOpen((v) => !v)}
        onClear={() => setLogs([])}
      />
      {toastNode}
      {confirmNode}

      {changelogPkg && range && (
        <ChangelogDrawer pkg={changelogPkg} from={range.from} latest={range.latest} onClose={() => setChangelogPkg(null)} />
      )}
      {modal === "machines" && (
        <MachinesModal initial={config.machines} onClose={() => setModal(null)} onSaved={onConfigChanged} />
      )}
      {modal === "packages" && (
        <PackagesModal initial={config.packages} onClose={() => setModal(null)} onSaved={onConfigChanged} />
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick?: () => void }) {
  return (
    <button className={`stat stat-${value ? tone : "zero"}`} onClick={onClick} disabled={!onClick || !value}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}
