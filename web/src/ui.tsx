import { useEffect, type ReactNode } from "react";
import type { Cell, CellStatus } from "./types";
import { STATUS_LABEL, hueOf, initials, type StatusCounts } from "./lib";
import { Icon } from "./icons";

/** 包头像：字母 + 按 id 稳定配色的渐变 */
export function Avatar({ id, label, size = 36 }: { id: string; label: string; size?: number }) {
  const h = hueOf(id);
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 80% 62%), hsl(${(h + 40) % 360} 75% 48%))`,
      }}
    >
      {initials(label)}
    </div>
  );
}

export function StatusPill({ status }: { status: CellStatus }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** 已装版本；落后时显示 旧 → 新 */
export function VersionText({ cell }: { cell?: Cell }) {
  if (!cell || cell.status === "checking") return <span className="ver shimmer">0.0.000</span>;
  if (!cell.installed) return <span className="ver muted">—</span>;
  if (cell.status === "outdated" && cell.latest) {
    return (
      <span className="ver">
        <span className="ver-old">{cell.installed}</span>
        <Icon name="arrowRight" size={12} className="ver-arrow" />
        <span className="ver-new">{cell.latest}</span>
      </span>
    );
  }
  return <span className="ver">{cell.installed}</span>;
}

/** 细的分段状态条：一眼看出某包在各机器上的分布 */
export function StatusBar({ counts }: { counts: StatusCounts }) {
  const order: CellStatus[] = ["uptodate", "outdated", "missing", "unknown", "checking"];
  return (
    <div className="statusbar">
      {order.map((s) =>
        counts[s] ? <span key={s} className={`seg seg-${s}`} style={{ flex: counts[s] }} /> : null
      )}
    </div>
  );
}

/** 模态框外壳：遮罩 + 居中面板 + Esc 关闭 */
export function Modal({
  title,
  icon,
  wide,
  onClose,
  footer,
  children,
}: {
  title: ReactNode;
  icon?: Parameters<typeof Icon>[0]["name"];
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEscape(onClose);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {icon && <Icon name={icon} size={18} />}
            {title}
          </h3>
          <button className="btn-icon" onClick={onClose} title="关闭 (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && fn();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [fn]);
}
