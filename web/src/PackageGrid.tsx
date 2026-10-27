import type { Cell, Machine, PackageDef } from "./types";
import { cellKey, countStatuses, isActionable } from "./lib";
import { Avatar, StatusBar, StatusPill, VersionText } from "./ui";
import { Icon } from "./icons";

export interface ViewProps {
  machines: Machine[];
  packages: PackageDef[];
  cellMap: Map<string, Cell>;
  busy: boolean; // 有更新在跑：禁止再触发更新
  activeKey: string | null; // 正在更新的 cell
  refreshingPkgs: Set<string>;
  onOpenChangelog: (pkg: PackageDef) => void;
  onUpdateCell: (host: string, pkg: PackageDef) => void;
  onUpdateRow: (pkg: PackageDef) => void;
  onRefreshRow: (pkg: PackageDef) => void;
}

/** 卡片视图：每个包一张卡，卡内列出各机器的版本与状态 */
export default function PackageGrid(p: ViewProps) {
  return (
    <div className="grid">
      {p.packages.map((pkg, i) => (
        <PackageCard key={pkg.id} pkg={pkg} index={i} {...p} />
      ))}
    </div>
  );
}

function PackageCard({ pkg, index, ...p }: ViewProps & { pkg: PackageDef; index: number }) {
  const rows = p.machines.map((m) => ({ m, c: p.cellMap.get(cellKey(m.host, pkg.id)) }));
  const counts = countStatuses(rows.map((r) => r.c));
  const latest = rows.find((r) => r.c?.latest)?.c?.latest;
  const source = pkg.npmName || pkg.pypiName || pkg.repo || pkg.id;

  return (
    <article className="card" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      <header className="card-head">
        <Avatar id={pkg.id} label={pkg.label} />
        <div className="card-title">
          <button className="card-name" onClick={() => p.onOpenChangelog(pkg)} title="查看更新内容">
            {pkg.label}
          </button>
          <div className="card-meta">
            <span className="tag">{pkg.manager}</span>
            <span className="card-source" title={source}>{source}</span>
          </div>
        </div>
        <div className="card-actions">
          <button className="btn-icon" title="更新内容" onClick={() => p.onOpenChangelog(pkg)}>
            <Icon name="file" />
          </button>
          <button className="btn-icon" title="刷新此包" onClick={() => p.onRefreshRow(pkg)}>
            <Icon name="refresh" className={p.refreshingPkgs.has(pkg.id) ? "spin" : ""} />
          </button>
        </div>
      </header>

      <div className="card-latest">
        <span>最新版本</span>
        <strong>{latest || "—"}</strong>
      </div>
      <StatusBar counts={counts} />

      <ul className="card-rows">
        {rows.map(({ m, c }) => {
          const status = c?.status || "unknown";
          const key = cellKey(m.host, pkg.id);
          const running = p.activeKey === key;
          return (
            <li key={m.host} className={`row row-${status}`} title={c?.error || ""}>
              <div className="row-machine">
                <span className="row-name">{m.name}</span>
                {c?.error && status !== "checking" && <span className="row-err">{c.error}</span>}
              </div>
              <VersionText cell={c} />
              <div className="row-end">
                {running ? (
                  <span className="pill pill-checking">
                    <Icon name="refresh" size={12} className="spin" />
                    更新中
                  </span>
                ) : isActionable(status) ? (
                  <button
                    className={`btn-sm ${status === "outdated" ? "accent" : ""}`}
                    disabled={p.busy}
                    onClick={() => p.onUpdateCell(m.host, pkg)}
                  >
                    <Icon name={status === "outdated" ? "up" : "download"} size={13} />
                    {status === "outdated" ? "更新" : "安装"}
                  </button>
                ) : (
                  <StatusPill status={status} />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {counts.outdated > 0 && (
        <footer className="card-foot">
          <span>
            {counts.uptodate}/{counts.total} 台已最新
          </span>
          <button className="btn-sm accent" disabled={p.busy} onClick={() => p.onUpdateRow(pkg)}>
            <Icon name="upCircle" size={13} />
            全部更新（{counts.outdated}）
          </button>
        </footer>
      )}
    </article>
  );
}
