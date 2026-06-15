import { useEffect, useState } from "react";
import { getSettings, saveSettings, testConnection } from "./api";

export default function SettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [modelsText, setModelsText] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyFromEnv, setKeyFromEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings();
        setApiKey(s.apiKey); // 脱敏占位
        setBaseUrl(s.baseUrl);
        setModelsText(s.models.join("\n"));
        setHasKey(s.hasKey);
        setKeyFromEnv(s.keyFromEnv);
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function parseModels(): string[] {
    return modelsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function payload() {
    const body: { apiKey?: string; baseUrl: string; models: string[] } = {
      baseUrl,
      models: parseModels(),
    };
    // 只有用户改过 Key 才发送（避免脱敏占位覆盖真实 Key）
    if (keyTouched) body.apiKey = apiKey;
    return body;
  }

  async function onTest() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await testConnection(payload());
      setMsg(
        r.ok
          ? { ok: true, text: `连接成功（${r.model}）` }
          : { ok: false, text: `失败：${r.error}` }
      );
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setMsg(null);
    try {
      await saveSettings(payload());
      setMsg({ ok: true, text: "已保存" });
      onSaved();
      setTimeout(onClose, 500);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>⚙️ AI 设置 · DeerAPI</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p>加载中…</p>
          ) : (
            <>
              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyTouched(true);
                  }}
                />
                <small>
                  {keyFromEnv
                    ? "当前来自环境变量 DEERAPI_API_KEY"
                    : hasKey
                    ? "已保存（脱敏显示，留空不改动）"
                    : "尚未设置"}
                </small>
              </label>

              <label className="field">
                <span>Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.deerapi.com/v1"
                />
              </label>

              <label className="field">
                <span>模型降级链（每行一个，从上到下优先）</span>
                <textarea
                  rows={4}
                  value={modelsText}
                  onChange={(e) => setModelsText(e.target.value)}
                  placeholder={"gpt-5.5\ngpt-5.4\ngemini-3.1-pro-preview"}
                />
                <small>
                  调用时按顺序尝试，前一个失败（限流/模型不存在/服务错误）自动降级到下一个；401 鉴权失败立即停止。
                </small>
              </label>

              {msg && (
                <p className={msg.ok ? "ok-msg" : "err-msg"}>{msg.text}</p>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button onClick={onTest} disabled={testing || loading}>
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button className="primary" onClick={onSave} disabled={saving || loading}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
