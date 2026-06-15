export interface Machine {
  name: string;
  host: string;
  enabled?: boolean;
  source?: "config" | "ui";
}

export interface PackageDef {
  id: string;
  label: string;
  manager: string;
  npmName?: string;
  pypiName?: string;
  repo?: string;
  versionCommand: string;
  versionRegex?: string;
  updateCommand: string;
  source?: "config" | "ui";
}

export interface SshHost {
  host: string;
  hostName?: string;
  user?: string;
  alreadyAdded?: boolean;
}

export type CellStatus =
  | "uptodate"
  | "outdated"
  | "missing"
  | "unknown"
  | "checking";

export interface Cell {
  machine: string;
  packageId: string;
  installed: string | null;
  latest: string | null;
  status: CellStatus;
  error?: string;
  checkedAt?: string;
}

export interface ConfigResp {
  machines: Machine[];
  packages: PackageDef[];
  usingExampleConfig: boolean;
  aiEnabled: boolean;
}

export interface ReleaseNote {
  tag: string;
  name: string;
  body: string;
  url: string;
}

export interface ChangelogResp {
  summary: string;
  aiEnabled: boolean;
  model?: string;
  releases: ReleaseNote[];
  note?: string;
}

export interface SettingsResp {
  baseUrl: string;
  models: string[];
  apiKey: string; // 脱敏
  hasKey: boolean;
  keyFromEnv: boolean;
}

export interface TestConnResp {
  ok: boolean;
  model?: string;
  error?: string;
}
