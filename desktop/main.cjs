// ipackage 的 macOS 桌面壳：在主进程内嵌运行打包好的后端，再用 BrowserWindow 打开本地页面。
// 后端由 esbuild 打成 build/server.cjs（依赖全部内联），所以 .app 里不需要 node_modules。
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const BUILD_DIR = path.join(__dirname, "build");
const BG_COLOR = "#0b0c10";

let mainWindow = null;
let serverUrl = null;

// ---- 单实例：重复打开时聚焦已有窗口 ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(boot).catch((err) => {
    dialog.showErrorBox("ipackage 启动失败", String((err && err.stack) || err));
    app.exit(1);
  });
}

/**
 * GUI 启动的 App 只拿到 launchd 的极简 PATH（/usr/bin:/bin:...），找不到 gh / npm / claude 等。
 * 这里用用户登录 shell（本机是 fish）跑一次 `echo "$PATH"` 拿到完整 PATH 并合并进来。
 * fish 对 PATH 这类 path 变量在加引号展开时会用冒号连接，所以 bash/zsh/fish 同一条命令都适用。
 */
function fixPath() {
  const fallback = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"];
  let shellPath = "";
  const userShell = (() => {
    try {
      return os.userInfo().shell || process.env.SHELL || "/bin/zsh";
    } catch {
      return process.env.SHELL || "/bin/zsh";
    }
  })();
  try {
    const out = execFileSync(userShell, ["-l", "-c", 'echo "__IPKG_PATH__$PATH"'], {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // 登录脚本可能往 stdout 打印东西（banner 等），只取带标记的那一行
    const line = out.split("\n").find((l) => l.startsWith("__IPKG_PATH__"));
    if (line) shellPath = line.slice("__IPKG_PATH__".length).trim();
  } catch (err) {
    console.warn("[ipackage] 读取登录 shell PATH 失败，使用兜底路径：", err.message);
  }
  // 顺序：登录 shell 的 PATH 优先，其次原 PATH，最后兜底的 Homebrew 路径；去重
  const parts = [...shellPath.split(":"), ...(process.env.PATH || "").split(":"), ...fallback];
  const seen = new Set();
  process.env.PATH = parts.filter((p) => p && !seen.has(p) && seen.add(p)).join(":");
}

/** 首次启动把构建时打进来的种子配置拷到 userData（已存在则不覆盖）。 */
function seedUserData(configDir, dataDir) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const seeds = [
    [path.join(BUILD_DIR, "seed", "config.yaml"), path.join(configDir, "config.yaml")],
    [path.join(BUILD_DIR, "seed", "overrides.json"), path.join(dataDir, "overrides.json")],
  ];
  for (const [src, dst] of seeds) {
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
}

/** 先在 0 端口监听拿到系统分配的空闲端口，再关掉交给后端用。 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 轮询 /api/config 直到后端就绪。 */
async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/api/config`);
      if (r.ok) return;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`后端未在 ${timeoutMs}ms 内就绪：${lastErr && lastErr.message}`);
}

async function boot() {
  fixPath();

  const userData = app.getPath("userData"); // ~/Library/Application Support/ipackage
  const configDir = path.join(userData, "config");
  const dataDir = path.join(userData, "data");
  seedUserData(configDir, dataDir);

  const port = await getFreePort();
  Object.assign(process.env, {
    IPACKAGE_CONFIG_DIR: configDir,
    IPACKAGE_DATA_DIR: dataDir,
    IPACKAGE_WEB_DIST: path.join(BUILD_DIR, "web"),
    IPACKAGE_EXAMPLE_CONFIG: path.join(BUILD_DIR, "config.example.yaml"),
    HOST: "127.0.0.1",
    PORT: String(port),
  });

  // 后端在 import 时即 app.listen(PORT, HOST)
  require(path.join(BUILD_DIR, "server.cjs"));
  serverUrl = `http://127.0.0.1:${port}`;
  await waitForServer(serverUrl);

  buildMenu();
  createWindow();

  // macOS 惯例：点 Dock 图标且无窗口时重建
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow() {
  if (!serverUrl) return;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: "ipackage",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: BG_COLOR,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  // 兜底：页面加载失败或 ready-to-show 迟迟不来时也要把窗口亮出来，避免「进程在、窗口没有」
  const forceShow = () => mainWindow && !mainWindow.isVisible() && mainWindow.show();
  mainWindow.webContents.once("did-fail-load", forceShow);
  setTimeout(forceShow, 4000);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // 外链（target=_blank / window.open）一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 页面内直接跳到非本地地址也拦下来，用系统浏览器打开
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(serverUrl)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`${serverUrl}/?app=mac`);
}

function buildMenu() {
  const template = [
    { role: "appMenu" },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "拷贝" },
        { role: "paste", label: "粘贴" },
        { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
        { role: "delete", label: "删除" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { role: "reload", label: "重新载入" },
        { role: "forceReload", label: "强制重新载入" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    { role: "windowMenu", label: "窗口" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 关掉窗口不退出（macOS 惯例），Cmd+Q 才退出；后端跟随主进程一起结束。
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
