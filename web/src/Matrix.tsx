import { cellKey, countStatuses, isActionable } from "./lib";
import { Avatar, StatusPill, VersionText } from "./ui";
import { Icon } from "./icons";
import type { ViewProps } from "./PackageGrid";

/** 矩阵视图：包 × 机器，机器多时更紧凑 */
export default function Matrix(p: ViewProps) {
  return (
    <div className="matrix-card">
      <table className="matrix">
        <thead>
          <tr>
            <th className="corner">包</th>
            {p.machines.map((m) => (
              <th key={m.host} title={m.host}>
                {m.name}
                <small>{m.host}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.packages.map((pkg) => {
            const cells = p.machines.map((m) => p.cellMap.get(cellKey(m.host, pkg.id)));
            const latest = cells.find((c) => c?.latest)?.latest;
            const outdated = countStatuses(cells).outdated;
            return (
              <tr key={pkg.id}>
                <th className="mx-pkg">
                  <Avatar id={pkg.id} label={pkg.label} size={28} />
                  <div>
                    <button className="card-name" onClick={() => p.onOpenChangelog(pkg)}>
                      {pkg.label}
                    </button>
                    <small>最新 {latest || "—"}</small>
                  </div>
                  <div className="mx-actions">
                    <button className="btn-icon" title="刷新此包" onClick={() => p.onRefreshRow(pkg)}>
                      <Icon name="refresh" size={14} className={p.refreshingPkgs.has(pkg.id) ? "spin" : ""} />
                    </button>
                    {outdated > 0 && (
                      <button
                        className="btn-icon accent"
                        title={`更新 ${outdated} 台`}
                        disabled={p.busy}
                        onClick={() => p.onUpdateRow(pkg)}
                      >
                        <Icon name="upCircle" size={14} />
                      </button>
                    )}
                  </div>
                </th>
                {p.machines.map((m, i) => {
                  const c = cells[i];
                  const status = c?.status || "unknown";
                  const clickable = isActionable(status) && !p.busy;
                  const running = p.activeKey === cellKey(m.host, pkg.id);
                  return (
                    <td key={m.host}>
                      <div
                        className={`mx-cell mx-${status} ${clickable ? "clickable" : ""}`}
                        title={c?.error || (clickable ? "点击" + (status === "missing" ? "安装" : "更新") : "")}
                        onClick={clickable ? () => p.onUpdateCell(m.host, pkg) : undefined}
                      >
                        <VersionText cell={c} />
                        {running ? (
                          <span className="pill pill-checking">
                            <Icon name="refresh" size={12} className="spin" />
                            更新中
                          </span>
                        ) : (
                          <StatusPill status={status} />
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
  );
}
