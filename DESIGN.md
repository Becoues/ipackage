# ipackage — 多机 CLI 包版本监控与一键更新面板

## 1. 目标

一个**本地运行的可视化面板**，用来：

1. 监控**多台机器**（本机 + 若干 SSH 开发机）上**指定包**（claude code cli、lark cli 等）的**已安装版本**。
2. 对比每个包的**最新版本**（npm / PyPI / GitHub Releases）。
3. 用 **AI 总结** `当前版本 → 最新版本` 之间更新了什么（新功能 / 破坏性变更 / 修复）。
4. 允许**按机器 / 按包勾选更新**，或**一键更新所有落后的包**到最新版本，实时回显输出。
5. 包列表**可增删**（改一个 yaml 即可）。

非目标（v1 不做）：自动定时巡检通知、权限多用户、Windows 远程（远程端假设为 Linux/macOS）。

## 2. 总体架构

```
┌─────────────────────────────────────────────┐
│  浏览器 (React + Vite)  http://localhost:5173 │
│   版本矩阵表 / AI changelog 面板 / 更新输出   │
└───────────────┬─────────────────────────────┘
                │ HTTP + SSE (/api/*)
┌───────────────▼─────────────────────────────┐
│  本地 Node 服务 (Express, :8787)             │
│  ┌──────────┬───────────┬──────────────────┐ │
│  │ ssh.ts   │ registry  │ changelog (AI)   │ │
│  │ 跑命令   │ 查最新版  │ 抓 release+总结  │ │
│  └────┬─────┴─────┬─────┴────────┬─────────┘ │
└───────┼───────────┼──────────────┼───────────┘
        │           │              │
   系统 ssh      npm/pypi/      GitHub API
   (~/.ssh/      github         + Anthropic API
    config)      registry
```

**关键设计决策：用系统 `ssh` 客户端，而不是在 Node 里管密钥。**
后端执行远程命令时直接 `child_process` 调用本机 `ssh <alias> '<cmd>'`，从而**复用用户现成的 `~/.ssh/config`**（别名、跳板机 ProxyJump、密钥、ssh-agent 全部自动生效）。本机包则直接本地执行命令，不走 ssh。这样零密钥管理、零额外配置。

## 3. 数据模型

### 机器 Machine
```ts
{
  name: string;      // 显示名
  host: string;      // ssh config 里的 Host 别名；或 user@ip；"local" 表示本机
  enabled?: boolean; // 默认 true
}
```

### 包 Package
```ts
{
  id: string;            // 唯一 id，如 "claude-code"
  label: string;         // 显示名
  manager: "npm" | "pypi" | "github" | "custom";
  // 查最新版用：
  npmName?: string;      // manager=npm
  pypiName?: string;     // manager=pypi
  repo?: string;         // "owner/name"，manager=github 或用于抓 changelog
  // 查已安装版用（在目标机器上执行）：
  versionCommand: string;     // 如 "claude --version"
  versionRegex?: string;      // 提取版本号，默认 (\d+\.\d+\.\d+\S*)
  // 更新用（在目标机器上执行）：
  updateCommand: string;      // 如 "npm i -g @anthropic-ai/claude-code@latest"
  // 按机器覆盖命令（key=机器 host）：某机器需不同命令时用，如本机 sudo：
  machineOverrides?: Record<string, { versionCommand?: string; updateCommand?: string }>;
}
```

命令解析：执行某机器上的查版本/更新时，先取 `machineOverrides[host]` 里对应命令，没有再回退包级默认（`effectiveCommand()`）。

### 运行期状态 Cell（机器 × 包）
```ts
{
  machine: string;
  packageId: string;
  installed: string | null;   // 已安装版本，null=未装/查不到
  latest: string | null;      // 最新版本
  status: "uptodate" | "outdated" | "missing" | "unknown" | "checking";
  error?: string;
  checkedAt?: string;
}
```

`status` 判定：`installed` 与 `latest` 都有 → semver 比较，相等/更新=uptodate，落后=outdated；`installed` 为 null=missing；任一查询失败=unknown。

## 4. 配置

单个 `config/config.yaml`（首启从 `config.example.yaml` 复制）：

```yaml
machines:
  - { name: 本机, host: local }
  - { name: 阿里开发机, host: ali-dev }
  - { name: k8s, host: k8s }

packages:
  - id: claude-code
    label: Claude Code CLI
    manager: npm
    npmName: "@anthropic-ai/claude-code"
    repo: anthropics/claude-code
    versionCommand: "claude --version"
    updateCommand: "npm i -g @anthropic-ai/claude-code@latest"
```

AI 相关设置（DeerAPI Key / baseUrl / 模型降级链）**不放 config.yaml**，而是持久化在 `data/settings.json`（见 §6、§11），可在网页「设置」里改。优先级：`settings.json` > 环境变量 `DEERAPI_API_KEY`。未配置 Key 时 changelog 退化为"只展示抓到的 release 原文，不做 AI 总结"。

## 5. 后端 API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/config` | 返回机器/包列表（含 `source: config\|ui`），供前端渲染表头 |
| GET | `/api/ssh-hosts` | 解析 `~/.ssh/config` 返回可用 Host 别名（带 `alreadyAdded` 标记） |
| POST | `/api/machines` | body: `{machines}`，整组覆盖机器列表（保证 `local` 在列），存 `data/overrides.json` |
| POST | `/api/packages` | body: `{packages}`，整组覆盖包列表（校验 id 唯一 + manager 依赖），存 `data/overrides.json` |
| GET | `/api/status` | 返回缓存的所有 cell 状态（秒回，不阻塞） |
| POST | `/api/refresh` | 触发一轮全量检查（已装版本走 ssh 并发，最新版本走 registry）；支持 `?only=machine,pkg` |
| GET | `/api/changelog?pkg=&from=&to=` | 抓 GitHub releases 区间并用 AI 总结，返回 markdown |
| POST | `/api/update` | body: `{machine, packageId}`；流式（NDJSON）回传更新命令的 stdout/stderr 与退出码 |
| POST | `/api/update-all` | 对所有 `outdated` 的 cell 串行更新，NDJSON 流式回传 |
| GET | `/api/settings` | 返回 AI 设置（Key **脱敏**：前4…后4，不回明文） |
| POST | `/api/settings` | 保存 Key/baseUrl/models；传入脱敏占位的 Key 会被忽略（防覆盖） |
| POST | `/api/settings/test-connection` | 对 DeerAPI 发一次最小请求（`max_tokens:1`）验证连通性 |

**最新版本查询**（registry.ts）：
- npm → `GET https://registry.npmjs.org/<name>/latest` 取 `.version`
- pypi → `GET https://pypi.org/pypi/<name>/json` 取 `.info.version`
- github → `GET https://api.github.com/repos/<repo>/releases/latest` 取 `tag_name`（去掉前缀 v）

**已安装版本查询**（ssh.ts）：在机器上跑 `versionCommand`，用 `versionRegex` 提取。

## 6. AI changelog 总结流程（DeerAPI + 模型降级）

DeerAPI 是 **OpenAI 兼容网关**（`https://api.deerapi.com/v1`，鉴权 `Authorization: Bearer sk-...`），无需专属 SDK，直接打 `POST {baseUrl}/chat/completions`。

1. `GET https://api.github.com/repos/<repo>/releases?per_page=100`。
2. 按 tag 的 semver 过滤出 `(from, to]` 区间的 release，拼接其 `name + body`。
3. **按模型降级链依次尝试**（默认 `gpt-5.5 → gpt-5.4 → gemini-3.1-pro-preview`，可在设置里改顺序）：
   - 命中即返回，并记录所用 model；
   - 失败时：`401/403` 鉴权错误**立即停止**（换模型也没用）；`404/429/5xx` 等**自动降级**到下一个模型。
4. prompt：把 release notes 总结成中文要点（✨ 新功能 / ⚠️ 破坏性变更 / 🐛 修复 / 📦 其他），并给出是否建议升级。
5. 返回 `{summary, model, releases, note}`，前端抽屉渲染，并标注「由 \<model\> 总结」。无 Key 或抓不到 release 时返回原文/提示。

借鉴《DeerAPI 调用最佳实践》：DB(settings)→env 的配置优先级、GET 脱敏、PUT 防脱敏覆盖、test-connection 最小请求校验。

## 7. 前端交互

- **版本矩阵表**：行=包，列=机器。单元格显示已安装版本，配色：绿=最新、橙=落后、灰=未装/未知、蓝闪=检查中。每行行首显示「最新版本」徽标。
- **刷新**：全量 / 单元格右键单刷。
- **点包名** → 右侧抽屉拉 AI changelog 总结。
- **点落后单元格** → 弹确认 → 走 SSE，底部控制台实时打印更新日志。
- **一键更新全部落后**：顶部按钮，串行执行，控制台滚动输出。

## 8. 安全 / 边界

- 仅监听 `127.0.0.1`，不对外暴露。
- 更新命令来自本地配置文件（用户自己写），后端不对命令做拼接注入；机器 host 仅允许出现在配置白名单中。
- ssh 首次连接需已配置好免密（密钥/agent）；交互式密码不支持。
- 远程命令默认超时（查版本 20s、更新 600s）。

## 9. 目录结构

```
ipackage/
├── DESIGN.md
├── README.md
├── package.json            # 根脚本：dev/build/start，并发起 server+web
├── Dockerfile              # 多阶段构建（build web+server -> 单端口运行）
├── docker-compose.yml      # 卷持久化 + 挂载 ~/.ssh
├── .dockerignore
├── .gitignore
├── .env.example
├── config/
│   ├── config.example.yaml
│   └── config.yaml         # 机器/包配置（gitignore，docker 卷挂载）
├── data/                   # 运行期持久化（gitignore，docker 命名卷）
│   ├── settings.json       # DeerAPI Key/baseUrl/模型链（脱敏对外）
│   └── overrides.json      # 网页里改动的机器/包（yaml 种子之上的覆盖层）
├── server/
│   ├── tsconfig.json
│   └── src/
│       ├── types.ts
│       ├── config.ts       # yaml 种子 + overrides 合并、保证 local 置顶
│       ├── overrides.ts    # data/overrides.json 读写（机器/包整组覆盖）
│       ├── sshConfig.ts    # 解析 ~/.ssh/config 发现 Host 别名
│       ├── settings.ts     # AI 设置持久化 + 脱敏 + env 回退
│       ├── ssh.ts
│       ├── registry.ts
│       ├── changelog.ts    # DeerAPI 调用 + 模型降级链
│       ├── checker.ts      # 编排：刷新所有 cell，维护内存缓存
│       └── index.ts        # Express 路由（含 机器/包 / settings / 流式更新）
└── web/
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── MachinesModal.tsx   # 🖥️ 机器管理（SSH 发现 / 勾选 / 增删）
        ├── PackagesModal.tsx   # 📦 包管理（增删 / 添加表单）
        ├── SettingsModal.tsx   # ⚙️ AI 设置弹窗
        ├── api.ts
        ├── types.ts
        └── styles.css
```

## 10. 运行

**本地开发（SSH 复用最顺）：**
```bash
cd /Users/mac/VAST/ipackage
npm install            # 装根 + server + web 依赖
cp config/config.example.yaml config/config.yaml   # 改成你的机器和包
npm run dev            # 同时起后端(:8787)和前端(:5173)，浏览器开 5173
# AI Key：进页面点「⚙️ 设置」填 DeerAPI Key（持久化），或 cp .env.example .env 写 DEERAPI_API_KEY
```

**Docker（部署 + 持久化）：**
```bash
cp config/config.example.yaml config/config.yaml
docker compose up -d --build          # 访问 http://localhost:8787
```
- `config/` 挂宿主目录、`data` 命名卷 → Key 与配置重启不丢。
- compose 把宿主 `~/.ssh` 挂到容器 `/root/.ssh`（OpenSSH 按 `getpwuid` 找 home，不认 `$HOME`），并自动忽略 `UseKeychain` 等 macOS 专属配置项，使 ssh 别名/密钥/ProxyJump 在容器内可用（细节与限制见 README）。
