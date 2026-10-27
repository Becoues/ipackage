// 把 App 运行所需的静态资源收拢到 desktop/build/：
//   web/dist -> build/web，config.example.yaml -> build/，
//   以及首次启动种子 -> build/seed/（个人版：仓库里的 config.yaml / overrides.json；分享版：share-config.yaml）。
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const ROOT = path.resolve(DESKTOP, "..");
const BUILD = path.join(DESKTOP, "build");

const webDist = path.join(ROOT, "web", "dist");
if (!fs.existsSync(path.join(webDist, "index.html"))) {
  console.error("✗ 找不到 web/dist/index.html，请先在仓库根目录执行 npm run build");
  process.exit(1);
}

fs.mkdirSync(BUILD, { recursive: true });

// 前端产物：整目录替换，避免残留旧的 hash 文件
fs.rmSync(path.join(BUILD, "web"), { recursive: true, force: true });
fs.cpSync(webDist, path.join(BUILD, "web"), { recursive: true });

fs.copyFileSync(
  path.join(ROOT, "config", "config.example.yaml"),
  path.join(BUILD, "config.example.yaml")
);

// 种子：个人构建直接带上自己的真实配置（不存在就跳过）；
// 分享版（IPACKAGE_SHARE=1）只带 share-config.yaml（本机 + 公开包），不泄露自己的机器列表。
const SHARE = process.env.IPACKAGE_SHARE === "1";
const seedDir = path.join(BUILD, "seed");
fs.rmSync(seedDir, { recursive: true, force: true });
const seeds = SHARE
  ? [[path.join(DESKTOP, "share-config.yaml"), "config.yaml"]]
  : [
      [path.join(ROOT, "config", "config.yaml"), "config.yaml"],
      [path.join(ROOT, "data", "overrides.json"), "overrides.json"],
    ];
if (SHARE) console.log("  分享版：不带个人配置");
for (const [src, name] of seeds) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(seedDir, { recursive: true });
    fs.copyFileSync(src, path.join(seedDir, name));
    console.log(`  seed: ${path.relative(ROOT, src)}`);
  }
}

if (!fs.existsSync(path.join(BUILD, "server.cjs"))) {
  console.error("✗ 缺少 build/server.cjs，请先执行 npm run build:server");
  process.exit(1);
}
console.log("✓ 资源已就绪：desktop/build/");
