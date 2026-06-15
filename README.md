# 📦 ipackage

多机 CLI 包版本监控与一键更新面板。在一个本地网页里看清**本机 + 各 SSH 开发机**上指定包（Claude Code CLI、Lark CLI…）的**已装版本 vs 最新版本**，用 **AI 总结**更新了什么，并**按机器/按包勾选更新**或**一键更新所有落后包**。

> 设计细节见 [DESIGN.md](./DESIGN.md)。

## 核心特性

- 🖥️ **多机**：复用你现成的 `~/.ssh/config`（别名、跳板机 ProxyJump、密钥、ssh-agent 全自动），无需在工具里另配密钥。顶部「🖥️ 机器」可**从 `~/.ssh/config` 一键发现别名 → 勾选加入 / 启用停用**，本机（local）固定保留。
- 🔢 **版本矩阵**：行=包、列=机器，配色一眼看出谁落后（绿=最新 / 橙=可更新 / 灰=未装 / 红=未知）。
- 🤖 **AI changelog**：点包名，自动抓 GitHub Releases 区间并总结「新功能 / 破坏性变更 / 修复 / 是否建议升级」。走 **DeerAPI**（OpenAI 兼容网关），**Key 在网页里设置并持久化**，模型**降级链** `gpt-5.5 → gpt-5.4 → gemini-3.1-pro-preview`（前一个失败自动降级）。
- 🐳 **Docker**：一条 `docker compose up` 起服务，Key 与配置持久化在卷里，重启不丢。
- ⬆️ **更新**：点落后单元格更新单个，或顶部「一键更新全部」，命令输出实时回显在底部控制台。
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

# 4.（可选）开启 AI 总结：点右上角「⚙️ 设置」，填 DeerAPI Key → 测试连接 → 保存
#   不填也能用，只是 changelog 只展示 release 原文
```

首次进入会自动跑一轮检查（查各机器已装版本 + 各包最新版本）。之后点「↻ 刷新」重查。

## 在网页里管理机器与包

机器和包既可手写 `config/config.yaml`，也能直接在网页顶部增删 —— 改动整组持久化到 `data/overrides.json`，**不回写、不破坏** `config.yaml`（注释/示例原样保留）。

- **🖥️ 机器**：本机（`local`）固定置顶、不可删；其它机器——
  - 点「↻ 从 SSH config 发现」自动解析 `~/.ssh/config` 的 `Host` 别名（带 HostName / User 预览），「+ 加入」即纳入；
  - 每台机器一个**启用复选框**，停用的机器从矩阵里隐藏、不再检查；可改显示名、可删除。
- **📦 包**：列出现有包可删；「添加包」表单填 `id / label / manager / 包名或 repo / versionCommand / updateCommand` 即新增一行，立刻并入矩阵开始检查。
- **持久化与回滚**：`config.yaml` 是初始**种子**；一旦在网页里改过机器/包，之后以 `data/overrides.json` 为准。想回到纯 yaml 配置，删掉 `data/overrides.json` 即可（Docker 下删卷里的同名文件）。

> 注：Docker 部署时这些接口在后端容器里，改了后端代码需 `docker compose up -d --build` 重建镜像才会生效。

## AI 总结（DeerAPI）

点包名会抓取 `当前版本 → 最新版本` 之间的 GitHub Release 并用 AI 总结。AI 走 [DeerAPI](https://www.deerapi.com)（OpenAI 兼容网关，`https://api.deerapi.com/v1`）。

- **设置方式**：右上角「⚙️ 设置」里填 API Key / Base URL / 模型降级链，「测试连接」校验后保存。Key **脱敏显示、持久化**在 `data/settings.json`（GET 不回传明文，留空保存不会覆盖已存 Key）。
- **模型降级链**：默认 `gpt-5.5 → gpt-5.4 → gemini-3.1-pro-preview`。调用时按顺序尝试，前一个失败（限流 / 模型不存在 / 5xx）自动降到下一个；**401 鉴权失败立即停止**，不浪费配额。
- **优先级**：`data/settings.json` 里的 Key > 环境变量 `DEERAPI_API_KEY`。

## 用 Docker 跑（推荐部署方式）

```bash
cd ipackage
cp config/config.example.yaml config/config.yaml   # 改成你的机器和包（之后也可在网页里增删）
docker compose up -d --build
#   访问 http://localhost:8787 ，在「设置」里填 DeerAPI Key（会持久化到卷）
```

**持久化**：
- `config/` 直接挂宿主目录 —— 在宿主上改 `config.yaml` 即时生效。
- `data` 命名卷 —— DeerAPI Key、baseUrl、模型链存这里，`docker compose down` 再 `up` 不丢。

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
    repo: anthropics/claude-code       # 用于 AI changelog
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

## 前置条件

- Node ≥ 18（开发机用了 Node 22）。
- 远程机器已配置**免密 SSH**（密钥/agent），工具用 `BatchMode` 不支持交互式密码。
- 远程机器上 `versionCommand` / `updateCommand` 用到的命令在登录 shell 的 PATH 里可用（工具用 `bash -lc` 包了一层以加载登录环境）。

## 生产构建（可选）

```bash
npm run build        # 编译 server 到 dist、打包 web 到 web/dist
npm start            # 只起后端，并托管已构建的前端，访问 http://127.0.0.1:8787
```

## 安全边界

- 服务只监听 `127.0.0.1`，不对外暴露。
- 更新命令完全来自你本地的 config.yaml，后端原样执行，不做拼接。
- 仅配置白名单内的机器可被操作。

## 目录

```
server/   Node + Express 后端
          ├─ ssh.ts / registry.ts / changelog.ts   查版本 / 查最新 / AI 总结
          ├─ sshConfig.ts                          解析 ~/.ssh/config 发现机器
          ├─ config.ts + overrides.ts              yaml 种子 + data/overrides.json 合并
          └─ checker.ts / index.ts                 编排 + Express 路由（含机器/包/流式更新）
web/      React + Vite 前端
          ├─ App.tsx + styles.css                  版本矩阵 / 更新控制台
          ├─ MachinesModal.tsx / PackagesModal.tsx 网页里管理机器与包
          └─ SettingsModal.tsx                     DeerAPI 设置
config/   机器与包配置（config.yaml 本地，example 入库）
data/     运行期持久化：settings.json / overrides.json（不入库，Docker 卷）
```
