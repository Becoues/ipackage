# ipackage — 多机 CLI 包版本监控与一键更新面板

## 1. 目标

一个**本地运行的可视化面板**，用来：

1. 监控**多台机器**（本机 + 若干 SSH 开发机）上**指定包**（claude code cli、lark cli 等）的**已安装版本**。
2. 对比每个包的**最新版本**（npm / PyPI / GitHub Releases）。
3. 查看 `当前版本 → 最新版本` 之间的 GitHub Release 更新内容。
4. 允许**按机器 / 按包勾选更新**，或**一键更新所有落后的包**到最新版本，实时回显输出。
5. 包列表**可增删**（改一个 yaml 即可）。

非目标（v1 不做）：自动定时巡检通知、权限多用户、Windows 远程（远程端假设为 Linux/macOS）。

## 2. 总体架构

```
┌─────────────────────────────────────────────┐
│  浏览器 (React + Vite)  http://localhost:5173 │
│   卡片/矩阵视图 / changelog 时间线 / 更新日志 │
└───────────────┬─────────────────────────────┘
                │ HTTP + SSE (/api/*)
┌───────────────▼─────────────────────────────┐
│  本地 Node 服务 (Express, :8787)             │
│  ┌──────────┬───────────┬──────────────────┐ │
│  │ ssh.ts   │ registry  │ changelog        │ │
│  │ 跑命令   │ 查最新版  │ 抓 release 区间  │ │
│  └────┬─────┴─────┬─────┴────────┬─────────┘ │
└───────┼───────────┼──────────────┼───────────┘
        │           │              │
   系统 ssh      npm/pypi/      GitHub API
   (~/.ssh/      github
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

私有仓库查最新版 / 抓 release 需要 `GITHUB_TOKEN`：取自 `.env` 或环境变量；都没有时自动尝试 `gh auth token`。

## 5. 后端 API

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/config` | 返回机器/包列表（含 `source: config\|ui`），供前端渲染表头 |
| GET | `/api/ssh-hosts` | 解析 `~/.ssh/config` 返回可用 Host 别名（带 `alreadyAdded` 标记） |
| POST | `/api/machines` | body: `{machines}`，整组覆盖机器列表（保证 `local` 在列），存 `data/overrides.json` |
| POST | `/api/packages` | body: `{packages}`，整组覆盖包列表（校验 id 唯一 + manager 依赖），存 `data/overrides.json` |
| GET | `/api/status` | 返回缓存的所有 cell 状态（秒回，不阻塞） |
| POST | `/api/refresh` | 触发一轮全量检查（已装版本走 ssh 并发，最新版本走 registry）；支持 `?only=machine,pkg` |
| GET | `/api/changelog?pkg=&from=&to=` | 抓 `(from, to]` 区间的 GitHub releases 原文（区间为空时退化为最近 5 个） |
| POST | `/api/update` | body: `{machine, packageId}`；流式（NDJSON）回传更新命令的 stdout/stderr 与退出码 |
| POST | `/api/update-all` | body 可带 `targets:[{machine,packageId}]`，缺省为所有 `outdated` 的 cell；串行更新，NDJSON 流式回传 |

**最新版本查询**（registry.ts）：
- npm → `GET https://registry.npmjs.org/<name>/latest` 取 `.version`
- pypi → `GET https://pypi.org/pypi/<name>/json` 取 `.info.version`
- github → `GET https://api.github.com/repos/<repo>/releases/latest` 取 `tag_name`（去掉前缀 v）

**已安装版本查询**（ssh.ts）：在机器上跑 `versionCommand`，用 `versionRegex` 提取。

## 6. Changelog

1. `GET https://api.github.com/repos/<repo>/releases?per_page=100`。
2. 按 tag 的 semver 过滤出 `(from, to]` 区间（from = 各机器最低已装版本，to = 最新版本），按版本倒序。
3. 返回 `{releases:[{tag,name,body,url,date}], inRange, note}`，前端以时间线 + Markdown 渲染。

## 7. 前端交互

- **布局**：左侧栏（状态过滤：全部 / 可更新 / 需处理；机器列表带健康点，点击只看该机器、悬停可单独刷新；管理入口）+ 主区（顶栏搜索 / 视图切换 / 刷新 / 全部更新，概览卡片含最新率圆环与各状态计数）。
- **两种视图**：卡片（每包一张，状态分布条 + 各机器行，落后行直接给「更新」按钮）/ 矩阵（行=包、列=机器）。选择记在 localStorage。
- **配色**：绿=最新、橙=可更新（显示 `旧 → 新`）、灰=未装、红=异常、蓝=检查中（骨架闪烁）。深色默认，跟随系统切换浅色。
- **点包名** → 右侧面板展示 release 时间线。
- **更新**：单台 / 按包 / 全部；执行前用自绘确认框展示实际命令（含 machineOverrides），执行中行内显示「更新中」，输出实时进右下角「活动」面板，结束后 Toast 提示并只刷新涉及的包。
- **快捷键**：`/` 或 `⌘K` 聚焦搜索，`Esc` 关闭面板/弹窗。
- **桌面 App**：以 `?app=mac` 打开时给红绿灯留位，侧栏顶部与顶栏可拖动窗口。

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
│   └── overrides.json      # 网页里改动的机器/包（yaml 种子之上的覆盖层）
├── server/
│   ├── tsconfig.json
│   └── src/
│       ├── types.ts
│       ├── config.ts       # yaml 种子 + overrides 合并、保证 local 置顶
│       ├── overrides.ts    # data/overrides.json 读写（机器/包整组覆盖）
│       ├── sshConfig.ts    # 解析 ~/.ssh/config 发现 Host 别名
│       ├── ssh.ts
│       ├── registry.ts
│       ├── changelog.ts    # 抓 GitHub release 区间
│       ├── checker.ts      # 编排：刷新所有 cell，维护内存缓存
│       ├── env.ts          # 加载 .env + gh auth token 兜底
│       └── index.ts        # Express 路由（含 机器/包 / 流式更新）
└── web/
    ├── index.html
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── App.tsx             # 外壳 + 状态编排（过滤 / 刷新 / 更新）
        ├── Sidebar.tsx         # 侧栏：状态过滤、机器列表、管理入口
        ├── PackageGrid.tsx     # 卡片视图
        ├── Matrix.tsx          # 矩阵视图
        ├── ChangelogDrawer.tsx # release 时间线面板
        ├── Markdown.tsx        # 极简 Markdown 渲染（不走 innerHTML）
        ├── ActivityPanel.tsx   # 更新日志面板
        ├── feedback.tsx        # 确认框 / Toast
        ├── ui.tsx / icons.tsx  # 通用组件 / 线性图标
        ├── lib.ts              # 版本比较、状态统计等纯函数
        ├── MachinesModal.tsx   # 机器管理（SSH 发现 / 勾选 / 增删）
        ├── PackagesModal.tsx   # 包管理（增删 / 添加表单）
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
# 私有仓库：cp .env.example .env 写 GITHUB_TOKEN，或已 gh auth login 则自动取
```

**Docker（部署 + 持久化）：**
```bash
cp config/config.example.yaml config/config.yaml
docker compose up -d --build          # 访问 http://localhost:8787
```
- `config/` 挂宿主目录、`data` 命名卷 → 配置重启不丢。
- compose 把宿主 `~/.ssh` 挂到容器 `/root/.ssh`（OpenSSH 按 `getpwuid` 找 home，不认 `$HOME`），并自动忽略 `UseKeychain` 等 macOS 专属配置项，使 ssh 别名/密钥/ProxyJump 在容器内可用（细节与限制见 README）。
