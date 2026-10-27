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
  machineOverrides?: Record<
    string,
    { versionCommand?: string; updateCommand?: string }
  >;
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
}

export interface ReleaseNote {
  tag: string;
  name: string;
  body: string;
  url: string;
  date?: string;
}

export interface ChangelogResp {
  releases: ReleaseNote[];
  inRange: boolean; // false = 区间内没匹配到，退化为最近 5 个
  note?: string;
}

/** /api/update(-all) 流式返回的 NDJSON 消息 */
export type UpdateMsg =
  | { type: "plan"; count: number }
  | { type: "start"; machine: string; packageId: string; command: string }
  | { type: "log"; stream: "out" | "err"; text: string }
  | { type: "done"; machine: string; packageId: string; code: number | null; installed: string | null }
  | { type: "all-done" };
