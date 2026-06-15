import { useState } from "react";
import { getSshHosts, saveMachines } from "./api";
import type { Machine, SshHost } from "./types";

export default function MachinesModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Machine[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [machines, setMachines] = useState<Machine[]>(
    initial.map((m) => ({ ...m }))
  );
  const [discovered, setDiscovered] = useState<SshHost[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const hasHost = (host: string) => machines.some((m) => m.host === host);

  function patch(host: string, p: Partial<Machine>) {
    setMachines((ms) => ms.map((m) => (m.host === host ? { ...m, ...p } : m)));
  }
  function remove(host: string) {
    setMachines((ms) => ms.filter((m) => m.host !== host));
  }
  function add(host: string, name?: string) {
    if (hasHost(host)) return;
    setMachines((ms) => [...ms, { name: name || host, host, enabled: true }]);
  }

  async function discover() {
    setDiscovering(true);
    setMsg(null);
    try {
      setDiscovered(await getSshHosts());
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setDiscovering(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setMsg(null);
    try {
      await saveMachines(machines);
      onSaved();
      onClose();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setSaving(false);
    }
  }

  const addable = (discovered || []).filter((h) => !hasHost(h.host));

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>🖥️ 机器管理</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="mlist">
            {machines.map((m) => {
              const isLocal = m.host === "local";
              return (
                <div className="mrow" key={m.host}>
                  <input
                    type="checkbox"
                    checked={isLocal ? true : m.enabled !== false}
                    disabled={isLocal}
                    title={isLocal ? "本机始终启用" : "勾选以在矩阵中显示/检查"}
                    onChange={(e) => patch(m.host, { enabled: e.target.checked })}
                  />
                  <input
                    className="mname"
                    value={m.name}
                    placeholder="显示名"
                    onChange={(e) => patch(m.host, { name: e.target.value })}
                  />
                  <code className="mhost">{m.host}</code>
                  {isLocal ? (
                    <span className="mtag">本机</span>
                  ) : (
                    <button className="mdel" onClick={() => remove(m.host)}>
                      删除
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="discover">
            <button onClick={discover} disabled={discovering}>
              {discovering ? "发现中…" : "↻ 从 SSH config 发现"}
            </button>
            {discovered && (
              <div className="discover-list">
                {addable.length === 0 ? (
                  <p className="muted-note">
                    {discovered.length === 0
                      ? "~/.ssh/config 里没找到可用的 Host 别名。"
                      : "已发现的别名都已加入。"}
                  </p>
                ) : (
                  addable.map((h) => (
                    <div className="drow" key={h.host}>
                      <div className="dinfo">
                        <code>{h.host}</code>
                        <small>
                          {[h.user && `${h.user}@`, h.hostName]
                            .filter(Boolean)
                            .join("") || "—"}
                        </small>
                      </div>
                      <button onClick={() => add(h.host)}>+ 加入</button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {msg && <p className={msg.ok ? "ok-msg" : "err-msg"}>{msg.text}</p>}
        </div>
        <div className="modal-foot">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存并刷新"}
          </button>
        </div>
      </div>
    </div>
  );
}
