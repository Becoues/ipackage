import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal } from "./ui";
import { Icon } from "./icons";

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  command?: string; // 将要执行的命令，等宽展示
  confirmText?: string;
}

/** Promise 式确认框，替代原生 confirm()（在桌面 App 里原生弹窗很突兀） */
export function useConfirm(): [(o: ConfirmOpts) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>();

  const confirm = useCallback((o: ConfirmOpts) => {
    setOpts(o);
    return new Promise<boolean>((res) => (resolver.current = res));
  }, []);

  const close = useCallback((v: boolean) => {
    resolver.current?.(v);
    setOpts(null);
  }, []);
  const cancel = useCallback(() => close(false), [close]);

  const node = opts && (
    <Modal
      title={opts.title}
      icon="upCircle"
      onClose={cancel}
      footer={
        <>
          <button onClick={cancel}>取消</button>
          <button className="primary" autoFocus onClick={() => close(true)}>
            {opts.confirmText || "确认"}
          </button>
        </>
      }
    >
      {opts.message && <div className="confirm-msg">{opts.message}</div>}
      {opts.command && <pre className="cmd">{opts.command}</pre>}
    </Modal>
  );
  return [confirm, node];
}

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  text: string;
}

/** 右下角轻提示，4s 自动消失 */
export function useToasts(): [(kind: Toast["kind"], text: string) => void, ReactNode] {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4000);
  }, []);

  const node = (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={t.kind === "ok" ? "checkCircle" : t.kind === "err" ? "alert" : "terminal"} />
          {t.text}
        </div>
      ))}
    </div>
  );
  return [push, node];
}
