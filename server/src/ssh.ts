import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

const SSH_OPTS = [
  // 忽略 macOS 专属指令（如 UseKeychain），否则在 Linux 容器里解析 ~/.ssh/config 会直接报错。
  // 必须排在最前，确保解析配置文件前已生效。
  "-o",
  "IgnoreUnknown=UseKeychain",
  "-o",
  "BatchMode=yes", // 不弹交互式密码，连不上直接失败
  "-o",
  "ConnectTimeout=15",
  "-o",
  "StrictHostKeyChecking=accept-new",
];

/**
 * 在指定机器上启动一个命令。host="local" 时本机执行，否则走系统 ssh，
 * 从而复用 ~/.ssh/config（别名、ProxyJump、密钥、agent）。
 * 远程统一用 `bash -lc` 包一层，确保能读到登录环境里的 PATH（nvm/npm 全局路径等）。
 */
export function spawnOn(
  host: string,
  command: string
): ChildProcessWithoutNullStreams {
  if (host === "local") {
    return spawn("/bin/bash", ["-lc", command], {
      env: process.env,
    });
  }
  return spawn("ssh", [...SSH_OPTS, host, `bash -lc ${shellQuote(command)}`]);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** 缓冲式执行，带超时。用于查版本/更新后的快速检查。 */
export function runOn(
  host: string,
  command: string,
  timeoutMs = 20000
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawnOn(host, command);
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
