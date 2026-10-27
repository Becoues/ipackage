import type { Cell, Machine, PackageDef } from "./types";
import { cellKey, countStatuses, formatTime } from "./lib";
import { Icon, type IconName } from "./icons";

export type StatusFilter = "all" | "outdated" | "problem";

interface Props {
  machines: Machine[];
  packages: PackageDef[];
  cellMap: Map<string, Cell>;
  statusFilter: StatusFilter;
  machineFilter: string | null;
  refreshingHosts: Set<string>;
  lastChecked?: string;
  onStatusFilter: (f: StatusFilter) => void;
  onMachineFilter: (host: string | null) => void;
  onRefreshMachine: (host: string) => void;
  onManageMachines: () => void;
  onManagePackages: () => void;
}

export default function Sidebar(p: Props) {
  const all = p.machines.flatMap((m) => p.packages.map((pkg) => p.cellMap.get(cellKey(m.host, pkg.id))));
  const total = countStatuses(all);

  const nav: { key: StatusFilter; label: string; icon: IconName; count: number; tone?: string }[] = [
    { key: "all", label: "全部包", icon: "layers", count: p.packages.length },
    { key: "outdated", label: "可更新", icon: "upCircle", count: total.outdated, tone: "warn" },
    { key: "problem", label: "需处理", icon: "alert", count: total.missing + total.unknown, tone: "bad" },
  ];

  return (
    <aside className="sidebar">
      <div className="sb-brand drag">
        <img src="/favicon.svg" alt="" />
        <div>
          <div className="sb-name">ipackage</div>
          <div className="sb-sub">多机包版本面板</div>
        </div>
      </div>

      <div className="sb-section">概览</div>
      {nav.map((n) => (
        <button
          key={n.key}
          className={`sb-item ${p.statusFilter === n.key ? "active" : ""}`}
          onClick={() => p.onStatusFilter(n.key)}
        >
          <Icon name={n.icon} />
          <span className="sb-label">{n.label}</span>
          {n.count > 0 && <span className={`sb-count ${n.tone || ""}`}>{n.count}</span>}
        </button>
      ))}

      <div className="sb-section">
        机器
        {p.machineFilter && (
          <button className="sb-clear" onClick={() => p.onMachineFilter(null)}>
            显示全部
          </button>
        )}
      </div>
      <div className="sb-machines">
        {p.machines.map((m) => {
          const c = countStatuses(p.packages.map((pkg) => p.cellMap.get(cellKey(m.host, pkg.id))));
          const tone = c.unknown ? "bad" : c.outdated ? "warn" : c.checking ? "busy" : "ok";
          const spinning = p.refreshingHosts.has(m.host);
          return (
            <div
              key={m.host}
              className={`sb-item sb-machine ${p.machineFilter === m.host ? "active" : ""}`}
              onClick={() => p.onMachineFilter(p.machineFilter === m.host ? null : m.host)}
              title={`只看 ${m.name}`}
            >
              <span className={`health ${tone}`} />
              <span className="sb-label">
                {m.name}
                <small>{m.host}</small>
              </span>
              {c.outdated > 0 && <span className="sb-count warn">{c.outdated}</span>}
              <button
                className="btn-icon sb-refresh"
                title={`刷新 ${m.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onRefreshMachine(m.host);
                }}
              >
                <Icon name="refresh" size={14} className={spinning ? "spin" : ""} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="sb-foot">
        <button className="sb-item" onClick={p.onManageMachines}>
          <Icon name="server" />
          <span className="sb-label">管理机器</span>
        </button>
        <button className="sb-item" onClick={p.onManagePackages}>
          <Icon name="package" />
          <span className="sb-label">管理包</span>
        </button>
        {p.lastChecked && <div className="sb-checked">上次检查 {formatTime(p.lastChecked)}</div>}
      </div>
    </aside>
  );
}
