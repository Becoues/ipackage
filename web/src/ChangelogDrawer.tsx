import { useEffect, useState } from "react";
import { getChangelog } from "./api";
import type { ChangelogResp, PackageDef } from "./types";
import { formatDate } from "./lib";
import { Avatar, useEscape } from "./ui";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";

/** 右侧面板：已装最低版本 → 最新版本 之间的 GitHub release，时间线展示 */
export default function ChangelogDrawer({
  pkg,
  from,
  latest,
  onClose,
}: {
  pkg: PackageDef;
  from: string | null;
  latest: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<ChangelogResp | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEscape(onClose);

  useEffect(() => {
    let alive = true;
    getChangelog(pkg.id, from, latest)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setExpanded(new Set(d.releases.slice(0, 1).map((r) => r.tag))); // 默认展开最新一条
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [pkg.id, from, latest]);

  const toggle = (tag: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(tag) ? n.delete(tag) : n.add(tag);
      return n;
    });

  return (
    <div className="overlay overlay-sheet" onMouseDown={onClose}>
      <aside className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <Avatar id={pkg.id} label={pkg.label} size={40} />
          <div className="sheet-title">
            <h2>{pkg.label}</h2>
            <div className="range">
              <span className="chip">{from || "?"}</span>
              <Icon name="arrowRight" size={12} />
              <span className="chip chip-accent">{latest || "最新"}</span>
              {data?.inRange && <span className="range-count">{data.releases.length} 个版本</span>}
            </div>
          </div>
          {pkg.repo && (
            <a
              className="btn-icon"
              href={`https://github.com/${pkg.repo}/releases`}
              target="_blank"
              rel="noreferrer"
              title={`在 GitHub 打开 ${pkg.repo}`}
            >
              <Icon name="github" />
            </a>
          )}
          <button className="btn-icon" onClick={onClose} title="关闭 (Esc)">
            <Icon name="x" />
          </button>
        </header>

        <div className="sheet-body">
          {!data && !error && (
            <div className="timeline">
              {[0, 1, 2].map((i) => (
                <div key={i} className="tl-item">
                  <span className="tl-dot" />
                  <div className="tl-card skeleton" />
                </div>
              ))}
            </div>
          )}
          {error && <div className="notice notice-err">{error}</div>}
          {data?.note && <div className="notice">{data.note}</div>}
          {data && (
            <div className="timeline">
              {data.releases.map((r, i) => {
                const open = expanded.has(r.tag);
                return (
                  <div key={r.tag} className={`tl-item ${i === 0 ? "first" : ""}`}>
                    <span className="tl-dot" />
                    <div className={`tl-card ${open ? "open" : ""}`}>
                      <button className="tl-head" onClick={() => toggle(r.tag)}>
                        <span className="chip">{r.tag}</span>
                        <span className="tl-name">{r.name && r.name !== r.tag && r.name !== `v${r.tag}` ? r.name : ""}</span>
                        <span className="tl-date">{formatDate(r.date)}</span>
                        <Icon name="chevronDown" size={14} className="tl-chevron" />
                      </button>
                      {open && (
                        <div className="tl-body">
                          {r.body.trim() ? <Markdown text={r.body} /> : <p className="muted">（无说明）</p>}
                          <a className="tl-link" href={r.url} target="_blank" rel="noreferrer">
                            在 GitHub 查看 <Icon name="external" size={12} />
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
