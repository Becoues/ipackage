import { useState } from "react";
import { Modal } from "./ui";
import { Icon } from "./icons";
import { savePackages } from "./api";
import type { PackageDef } from "./types";

type Manager = "npm" | "pypi" | "github" | "custom";

const EMPTY = {
  id: "",
  label: "",
  manager: "npm" as Manager,
  npmName: "",
  pypiName: "",
  repo: "",
  versionCommand: "",
  versionRegex: "",
  updateCommand: "",
};

export default function PackagesModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: PackageDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [packages, setPackages] = useState<PackageDef[]>(
    initial.map((p) => ({ ...p }))
  );
  const [draft, setDraft] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function setD(p: Partial<typeof EMPTY>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function remove(id: string) {
    setPackages((ps) => ps.filter((p) => p.id !== id));
  }

  function addDraft() {
    const id = draft.id.trim();
    if (!id) return setMsg({ ok: false, text: "请填写包 id" });
    if (packages.some((p) => p.id === id))
      return setMsg({ ok: false, text: `id 已存在：${id}` });
    if (!draft.versionCommand.trim())
      return setMsg({ ok: false, text: "请填写 versionCommand（读已装版本）" });
    if (!draft.updateCommand.trim())
      return setMsg({ ok: false, text: "请填写 updateCommand（执行更新）" });
    if (draft.manager === "npm" && !draft.npmName.trim())
      return setMsg({ ok: false, text: "manager=npm 需要 npmName" });
    if (draft.manager === "pypi" && !draft.pypiName.trim())
      return setMsg({ ok: false, text: "manager=pypi 需要 pypiName" });
    if (draft.manager === "github" && !draft.repo.trim())
      return setMsg({ ok: false, text: "manager=github 需要 repo" });

    const pkg: PackageDef = {
      id,
      label: draft.label.trim() || id,
      manager: draft.manager,
      npmName: draft.npmName.trim() || undefined,
      pypiName: draft.pypiName.trim() || undefined,
      repo: draft.repo.trim() || undefined,
      versionCommand: draft.versionCommand.trim(),
      versionRegex: draft.versionRegex.trim() || undefined,
      updateCommand: draft.updateCommand.trim(),
    };
    setPackages((ps) => [...ps, pkg]);
    setDraft({ ...EMPTY });
    setMsg({ ok: true, text: `已加入 ${id}，记得保存` });
  }

  async function onSave() {
    setSaving(true);
    setMsg(null);
    try {
      await savePackages(packages);
      onSaved();
      onClose();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setSaving(false);
    }
  }

  return (
    <Modal
      title="包管理"
      icon="package"
      wide
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={onSave} disabled={saving}>
            {saving ? "保存中…" : "保存并刷新"}
          </button>
        </>
      }
    >
          <div className="mlist">
            {packages.length === 0 && <p className="muted-note">还没有包。</p>}
            {packages.map((p) => (
              <div className="mrow" key={p.id}>
                <div className="pinfo">
                  <strong>{p.label || p.id}</strong>
                  <small>
                    <code>{p.id}</code>
                    <span className="mtag">{p.manager}</span>
                    {p.npmName || p.pypiName || p.repo || ""}
                  </small>
                </div>
                <button className="btn-icon danger" onClick={() => remove(p.id)} title="删除">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="addbox">
            <div className="addbox-title">添加包</div>
            <div className="grid2">
              <label className="field">
                <span>id（唯一）</span>
                <input
                  value={draft.id}
                  placeholder="pnpm"
                  onChange={(e) => setD({ id: e.target.value })}
                />
              </label>
              <label className="field">
                <span>显示名 label</span>
                <input
                  value={draft.label}
                  placeholder="pnpm"
                  onChange={(e) => setD({ label: e.target.value })}
                />
              </label>
              <label className="field">
                <span>manager</span>
                <select
                  value={draft.manager}
                  onChange={(e) => setD({ manager: e.target.value as Manager })}
                >
                  <option value="npm">npm</option>
                  <option value="pypi">pypi</option>
                  <option value="github">github</option>
                  <option value="custom">custom</option>
                </select>
              </label>
              {draft.manager === "npm" && (
                <label className="field">
                  <span>npmName</span>
                  <input
                    value={draft.npmName}
                    placeholder="@scope/name 或 name"
                    onChange={(e) => setD({ npmName: e.target.value })}
                  />
                </label>
              )}
              {draft.manager === "pypi" && (
                <label className="field">
                  <span>pypiName</span>
                  <input
                    value={draft.pypiName}
                    placeholder="uv"
                    onChange={(e) => setD({ pypiName: e.target.value })}
                  />
                </label>
              )}
              <label className="field">
                <span>repo（owner/name，用于 changelog{draft.manager === "github" ? "/查最新版" : ""}）</span>
                <input
                  value={draft.repo}
                  placeholder="cli/cli"
                  onChange={(e) => setD({ repo: e.target.value })}
                />
              </label>
              <label className="field">
                <span>versionCommand（读已装版本）</span>
                <input
                  value={draft.versionCommand}
                  placeholder="pnpm --version"
                  onChange={(e) => setD({ versionCommand: e.target.value })}
                />
              </label>
              <label className="field">
                <span>versionRegex（可选）</span>
                <input
                  value={draft.versionRegex}
                  placeholder="(\d+\.\d+\.\d+)"
                  onChange={(e) => setD({ versionRegex: e.target.value })}
                />
              </label>
              <label className="field grid2-full">
                <span>updateCommand（执行更新）</span>
                <input
                  value={draft.updateCommand}
                  placeholder="npm i -g pnpm@latest"
                  onChange={(e) => setD({ updateCommand: e.target.value })}
                />
              </label>
            </div>
            <div className="addbox-foot">
              <button onClick={addDraft}>
                <Icon name="plus" size={14} />
                加入列表
              </button>
            </div>
          </div>

          {msg && <p className={msg.ok ? "ok-msg" : "err-msg"}>{msg.text}</p>}
    </Modal>
  );
}
