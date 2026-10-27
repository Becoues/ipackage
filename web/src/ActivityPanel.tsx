import { useEffect, useRef } from "react";
import { Icon } from "./icons";

export interface LogLine {
  stream: "out" | "err" | "sys";
  text: string;
}

/** 右下角「活动」：收起时是一颗胶囊按钮，展开为终端风格的更新日志面板 */
export default function ActivityPanel({
  logs,
  open,
  busy,
  onToggle,
  onClear,
}: {
  logs: LogLine[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onClear: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [logs, open]);

  return (
    <>
      {open && (
        <section className="activity">
          <header className="activity-head">
            <span className="activity-title">
              <Icon name="terminal" />
              更新日志
              {busy && <span className="live">运行中</span>}
            </span>
            <div>
              <button className="btn-icon" title="清空" onClick={onClear} disabled={logs.length === 0}>
                <Icon name="trash" size={15} />
              </button>
              <button className="btn-icon" title="收起" onClick={onToggle}>
                <Icon name="chevronDown" />
              </button>
            </div>
          </header>
          <pre className="activity-body">
            {logs.length === 0 && <span className="ln sys">还没有更新记录。点击任意「更新」开始。</span>}
            {logs.map((l, i) => (
              <span key={i} className={`ln ${l.stream}`}>
                {l.text}
                {l.text.endsWith("\n") ? "" : "\n"}
              </span>
            ))}
            <div ref={endRef} />
          </pre>
        </section>
      )}
      {!open && (
        <button className={`dock ${busy ? "busy" : ""}`} onClick={onToggle}>
          {busy ? <Icon name="refresh" className="spin" /> : <Icon name="terminal" />}
          {busy ? "正在更新…" : "活动"}
          {!busy && logs.length > 0 && <span className="dock-dot" />}
        </button>
      )}
    </>
  );
}
