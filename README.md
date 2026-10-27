# 📦 ipackage

多机 CLI 包版本监控与一键更新面板。在一个本地网页里看清**本机 + 各 SSH 开发机**上指定包（Claude Code CLI、Lark CLI…）的**已装版本 vs 最新版本**，查看两版之间的 **Release 更新内容**，并**按机器/按包勾选更新**或**一键更新所有落后包**。

> 设计细节见 [DESIGN.md](./DESIGN.md)。

## 核心特性

- 🖥️ **多机**：复用你现成的 `~/.ssh/config`（别名、跳板机 ProxyJump、密钥、ssh-agent 全自动），无需在工具里另配密钥。顶部「🖥️ 机器」可**从 `~/.ssh/config` 一键发现别名 → 勾选加入 / 启用停用**，本机（local）固定保留。
- 🔢 **两种视图**：卡片（每包一张，含各机器版本与状态分布条）/ 矩阵（行=包、列=机器，机器多时更紧凑）。配色一眼看出谁落后（绿=最新 / 橙=可更新 / 灰=未装 / 红=异常），侧栏可按状态、按机器过滤，支持搜索（`/` 或 `⌘K`）。
- 📝 **Changelog**：点包名，右侧时间线展示 `已装最低版本 → 最新版本` 之间的 GitHub Release 原文（Markdown 渲染）。
- 🍎 **Mac App**：可打包成本地 `.app`（Electron，内嵌后端），见下文「Mac App」。
- 🐳 **Docker**：一条 `docker compose up` 起服务，配置持久化在卷里，重启不丢。
- ⬆️ **更新**：单台更新、按包更新所有落后机器，或「全部更新」；执行前展示实际命令确认，输出实时回显在右下角「活动」面板。
- ➕ **可扩展**：机器和包都能**在网页里增删管理**（顶部「🖥️ 机器」「📦 包」），也可继续手写 `config/config.yaml`。支持 npm / PyPI / GitHub Release。
  - 持久化：`config/config.yaml` 作初始**种子**；一旦在网页里改动机器/包，结果整组存进 `data/overrides.json`（Docker `data` 卷已持久化，重启不丢），**不回写、不破坏** `config.yaml` 的注释。想回到纯 yaml 配置，删掉 `data/overrides.json` 即可。

## 快速开始

```bash
git clone git@github.com:Becoues/ipackage.git
cd ipackage

# 1. 装依赖（根 + server + web，npm workspaces 一次搞定）
npm install

# 2. 配置你的机器和包
cp config/config.example.yaml config/config.yaml
#   编辑 config/config.yaml：machines.host 填 ~/.ssh/config 里的别名

# 3. 启动（同时起后端 :8787 和前端 :5173）
npm run dev
#   浏览器打开 http://localhost:5173

# 4.（可选）私有仓库查最新版需要 GITHUB_TOKEN：写进 .env，或已 `gh auth login` 则自动取
```

首次进入会自动跑一轮检查（查各机器已装版本 + 各包最新版本）。之后点顶栏刷新按钮重查全部，或在卡片 / 侧栏机器上单独刷新。

## 在网页里管理机器与包

机器和包既可手写 `config/config.yaml`，也能直接在网页侧栏「管理机器 / 管理包」里增删 —— 改动整组持久化到 `data/overrides.json`，**不回写、不破坏** `config.yaml`（注释/示例原样保留）。

- **管理机器**：本机（`local`）固定置顶、不可删；其它机器——
  - 点「从 ~/.ssh/config 发现」自动解析 `~/.ssh/config` 的 `Host` 别名（带 HostName / User 预览），「加入」即纳入；
  - 每台机器一个**启用复选框**，停用的机器从面板里隐藏、不再检查；可改显示名、可删除。
- **管理包**：列出现有包可删；「添加包」表单填 `id / label / manager / 包名或 repo / versionCommand / updateCommand` 即新增一项，立刻开始检查。
- **持久化与回滚**：`config.yaml` 是初始**种子**；一旦在网页里改过机器/包，之后以 `data/overrides.json` 为准。想回到纯 yaml 配置，删掉 `data/overrides.json` 即可（Docker 下删卷里的同名文件）。

> 注：Docker 部署时这些接口在后端容器里，改了后端代码需 `docker compose up -d --build` 重建镜像才会生效。

## 用 Docker 跑（推荐部署方式）

```bash
cd ipackage
cp config/config.example.yaml config/config.yaml   # 改成你的机器和包（之后也可在网页里增删）
docker compose up -d --build
#   访问 http://localhost:8787
```

**持久化**：
- `config/` 直接挂宿主目录 —— 在宿主上改 `config.yaml` 即时生效。
- `data` 命名卷 —— 网页里对机器/包的改动（`overrides.json`）存这里，`docker compose down` 再 `up` 不丢。

**容器里访问远程机器（SSH）**：compose 把宿主 `~/.ssh` 挂到容器的 **`/root/.ssh`**（OpenSSH 按系统用户库 `getpwuid` 找 home，容器内 root 即 `/root`，**不认 `$HOME` 环境变量**——这是踩过的坑）。ssh 别名、`~/.ssh` 下的密钥、ProxyJump 都能命中；容器内 ssh 还会自动忽略 `UseKeychain` 等 **macOS 专属**配置项（否则 Linux 的 ssh 解析 `~/.ssh/config` 会直接报错）。注意：

- 若 `config.yaml` 里 `IdentityFile` 用了**绝对路径**（如 `~/Documents/xxx.pem`），compose 已按同路径再挂一份 `~/Documents`；密钥在别处就照样补一行。
- 容器里的 `host: local` 指**容器本身**而非宿主。要监控宿主机，把它也作为一个 ssh 目标加进 `machines`。
- 只在宿主生效的网络（如 Tailscale 的 `100.x` 地址）在容器内不可达，这类机器用 `npm run dev` 原生跑。

## 配置说明（config/config.yaml）

```yaml
machines:
  - { name: 本机, host: local }       # local = 在本机直接执行
  - { name: 阿里开发机, host: ali-dev } # ssh 别名
  - { name: k8s, host: k8s }

packages:
  - id: claude-code
    label: Claude Code CLI
    manager: npm                       # npm | pypi | github | custom
    npmName: "@anthropic-ai/claude-code"
    repo: anthropics/claude-code       # 用于 changelog
    versionCommand: "claude --version" # 在机器上读已装版本
    versionRegex: "(\\d+\\.\\d+\\.\\d+)" # 可选，提取版本号
    updateCommand: "npm i -g @anthropic-ai/claude-code@latest"
```

| 字段 | 说明 |
|---|---|
| `manager` | 查最新版的来源：`npm`→registry，`pypi`→pypi.org，`github`→releases/latest |
| `versionCommand` | 在目标机器上执行、用来读「已装版本」的命令 |
| `versionRegex` | 从命令输出里提取版本号，默认 `(\d+\.\d+\.\d+[\w.-]*)` |
| `updateCommand` | 点更新时在目标机器上执行的命令 |
| `repo` | `owner/name`，用于抓 changelog（及 github manager 查最新版） |
| `machineOverrides` | 按机器 `host` 覆盖 `versionCommand`/`updateCommand`，如本机需 `sudo`：`machineOverrides.local.updateCommand: "sudo …"`（sudo 需免密，否则非交互执行会卡密码） |

## 前置条件

- Node ≥ 18（开发机用了 Node 22）。
- 远程机器已配置**免密 SSH**（密钥/agent），工具用 `BatchMode` 不支持交互式密码。
- 远程机器上 `versionCommand` / `updateCommand` 用到的命令在登录 shell 的 PATH 里可用（工具用 `bash -lc` 包了一层以加载登录环境）。

## 生产构建（可选）

```bash
npm run build        # 编译 server 到 dist、打包 web 到 web/dist
npm start            # 只起后端，并托管已构建的前端，访问 http://127.0.0.1:8787
```

## Mac App（Electron，Apple Silicon）

把面板打包成本地 `ipackage.app`：后端被 esbuild 打成单文件内嵌在 Electron 主进程里（随机空闲端口、只听 `127.0.0.1`），窗口直接加载它。`desktop/` 是独立 npm 包（不在 workspaces 里，Docker 不会装 Electron）。

```bash
npm --prefix desktop install   # 首次：装 electron / @electron/packager / esbuild
npm run app:build              # 构建 server+web，再打包 -> desktop/out/ipackage-darwin-arm64/ipackage.app
npm run app:start              # 不打包，直接用 electron 跑（调试用）
open desktop/out/ipackage-darwin-arm64/ipackage.app
```

- **配置与数据**：`~/Library/Application Support/ipackage/`，`config/config.yaml` + `data/overrides.json`。首次启动时若打包时仓库里有 `config/config.yaml`、`data/overrides.json`，会作为种子拷过去（已存在不覆盖）；之后与仓库互不影响。
- **PATH**：GUI App 默认 PATH 极简，启动时会用你的登录 shell（`$SHELL -l -c`，fish/zsh/bash 均可）读出完整 PATH 合并进来，本机命令（`claude`、`npm`、`gh`…）与开发时一致。
- **GITHUB_TOKEN**（私有仓库查最新版）：放在 `~/Library/Application Support/ipackage/config/.env`，或什么都不配——没有时会自动尝试 `gh auth token`（开发模式同样生效）。
- **图标**：`desktop/icon.icns` 已入库；改了 `web/public/favicon.svg` 后用 `npm --prefix desktop run icon` 重新生成（需要 Google Chrome）。
- 打包后整包做 ad-hoc 签名（免开发者账号）；不会自动拷进 `/Applications`。

### 分享给别人（分享版）

```bash
npm run app:share   # -> desktop/out/ipackage-<版本>-arm64.dmg
```

- 分享版**不带你的个人配置**：首次启动只有「本机」+ 公开包（见 `desktop/share-config.yaml`），对方在「管理机器」里从自己的 `~/.ssh/config` 添加机器。
- 只支持 Apple Silicon。未经 Apple 公证，对方首次打开会提示「Apple 无法验证…」：点「完成」→ 打开「系统设置 → 隐私与安全性」，在底部点「仍要打开」→ 再打开一次即可（之后正常双击）。或终端执行 `xattr -dr com.apple.quarantine /Applications/ipackage.app`。

## 安全边界

- 服务只监听 `127.0.0.1`，不对外暴露。
- 更新命令完全来自你本地的 config.yaml，后端原样执行，不做拼接。
- 仅配置白名单内的机器可被操作。

## 目录

```
server/   Node + Express 后端
          ├─ ssh.ts / registry.ts / changelog.ts   查版本 / 查最新 / 抓 Release
          ├─ sshConfig.ts                          解析 ~/.ssh/config 发现机器
          ├─ config.ts + overrides.ts              yaml 种子 + data/overrides.json 合并
          └─ checker.ts / index.ts                 编排 + Express 路由（含机器/包/流式更新）
web/      React + Vite 前端
          ├─ App.tsx + styles.css                  外壳 / 状态编排 / 设计令牌（深浅色）
          ├─ Sidebar / PackageGrid / Matrix        侧栏过滤、卡片视图、矩阵视图
          ├─ ChangelogDrawer + Markdown            Release 时间线
          ├─ ActivityPanel / feedback.tsx          更新日志、确认框、Toast
          └─ MachinesModal.tsx / PackagesModal.tsx 管理机器与包
desktop/  Mac App（Electron 壳，内嵌打包后的后端）
config/   机器与包配置（config.yaml 本地，example 入库）
data/     运行期持久化：overrides.json（不入库，Docker 卷）
```
