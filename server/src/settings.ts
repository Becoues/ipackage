import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.IPACKAGE_DATA_DIR || path.join(ROOT, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export interface Settings {
  baseUrl: string;
  apiKey: string; // DeerAPI sk-...，明文存盘（本地工具，文件在持久化卷里）
  models: string[]; // 降级优先级，从高到低
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://api.deerapi.com/v1",
  apiKey: "",
  models: ["gpt-5.5", "gpt-5.4", "gemini-3.1-pro-preview"],
};

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      baseUrl: s.baseUrl?.trim() || DEFAULT_SETTINGS.baseUrl,
      apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
      models:
        Array.isArray(s.models) && s.models.length
          ? s.models
          : DEFAULT_SETTINGS.models,
    };
  } catch {
    // 首次运行：用默认 + 环境变量回退
    return {
      ...DEFAULT_SETTINGS,
      apiKey: process.env.DEERAPI_API_KEY || "",
    };
  }
}

export function isMasked(k: string): boolean {
  return k.includes("...") || k.includes("•");
}

export function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

/** 实际可用密钥：设置文件优先，其次环境变量。 */
export function effectiveApiKey(): string {
  const s = loadSettings();
  return s.apiKey || process.env.DEERAPI_API_KEY || "";
}

/**
 * 保存设置。遵循文档里的"防脱敏覆盖"：传入的 apiKey 若是脱敏占位符则忽略，
 * 不会把真实 Key 覆盖成 `sk-1...abcd`。
 */
export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = loadSettings();
  const next: Settings = { ...cur };
  if (typeof patch.baseUrl === "string" && patch.baseUrl.trim()) {
    next.baseUrl = patch.baseUrl.trim();
  }
  if (Array.isArray(patch.models)) {
    const cleaned = patch.models.map((m) => String(m).trim()).filter(Boolean);
    if (cleaned.length) next.models = cleaned;
  }
  if (
    typeof patch.apiKey === "string" &&
    patch.apiKey.trim() &&
    !isMasked(patch.apiKey)
  ) {
    next.apiKey = patch.apiKey.trim();
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** 给前端的安全视图：Key 脱敏，不回传明文。 */
export function publicSettings() {
  const s = loadSettings();
  const key = effectiveApiKey();
  return {
    baseUrl: s.baseUrl,
    models: s.models,
    apiKey: maskKey(key),
    hasKey: !!key,
    keyFromEnv: !s.apiKey && !!process.env.DEERAPI_API_KEY,
  };
}
