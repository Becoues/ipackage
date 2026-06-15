export type Manager = "npm" | "pypi" | "github" | "custom";

export interface Machine {
  name: string;
  host: string; // "local" | ssh alias | user@host
  enabled?: boolean;
  source?: "config" | "ui"; // config.yaml 种子 or 网页管理；前端据此判断可否删除
}

export interface PackageDef {
  id: string;
  label: string;
  manager: Manager;
  npmName?: string;
  pypiName?: string;
  repo?: string; // "owner/name"
  versionCommand: string;
  versionRegex?: string;
  updateCommand: string;
  source?: "config" | "ui";
}

/** ~/.ssh/config 里发现的一个 Host 别名 */
export interface SshHost {
  host: string;
  hostName?: string;
  user?: string;
}

export interface AppConfig {
  machines: Machine[];
  packages: PackageDef[];
}

export type CellStatus =
  | "uptodate"
  | "outdated"
  | "missing"
  | "unknown"
  | "checking";

export interface Cell {
  machine: string; // machine.host as key
  packageId: string;
  installed: string | null;
  latest: string | null;
  status: CellStatus;
  error?: string;
  checkedAt?: string;
}
