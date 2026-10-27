// 用 @electron/packager 打出 ipackage.app，并做 ad-hoc 签名。
//   个人版：out/ipackage-darwin-arm64/ipackage.app
//   分享版（IPACKAGE_SHARE=1）：out/share/ipackage-darwin-arm64/ipackage.app + out/ipackage-<版本>-arm64.dmg
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { packager } = require("@electron/packager");

const DESKTOP = path.resolve(__dirname, "..");
const SHARE = process.env.IPACKAGE_SHARE === "1";
const { version } = require(path.join(DESKTOP, "package.json"));
const OUT = path.join(DESKTOP, "out", SHARE ? "share" : "");

// 只保留 main.cjs、package.json 和 build/，其余（node_modules、scripts、out、图标源文件…）都不进包
const KEEP = [/^\/main\.cjs$/, /^\/package\.json$/, /^\/build(\/|$)/];

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

/**
 * packager 改了 Info.plist / 资源后，Electron 自带的签名就失效了；别的 Mac 下载后
 * Gatekeeper 会直接报「已损坏」。这里整包重新 ad-hoc 签名（无需开发者账号），
 * 对方首次打开只会提示「无法验证开发者」，可在「隐私与安全性」里放行。
 */
function adhocSign(app) {
  run("codesign", ["--force", "--deep", "--sign", "-", app]);
  run("codesign", ["--verify", "--deep", "--strict", app]);
  console.log("✓ 已 ad-hoc 签名并校验");
}

/** 带「拖到 Applications」快捷方式的 dmg */
function makeDmg(app) {
  const stage = path.join(OUT, "dmg-stage");
  const dmg = path.join(DESKTOP, "out", `ipackage-${version}-arm64.dmg`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  run("ditto", [app, path.join(stage, "ipackage.app")]); // ditto 保留符号链接与签名
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  fs.rmSync(dmg, { force: true });
  run("hdiutil", ["create", "-volname", "ipackage", "-srcfolder", stage, "-format", "UDZO", "-ov", dmg]);
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`✓ dmg：${dmg}`);
}

(async () => {
  const paths = await packager({
    dir: DESKTOP,
    out: OUT,
    name: "ipackage",
    executableName: "ipackage",
    appBundleId: "dev.ipackage.app",
    appVersion: version,
    appCategoryType: "public.app-category.developer-tools",
    platform: "darwin",
    arch: "arm64",
    icon: path.join(DESKTOP, "icon.icns"),
    overwrite: true,
    prune: false, // 不需要任何运行时依赖
    asar: false, // 后端用 express.static 读文件，关掉 asar 省心
    ignore: (p) => p !== "" && !KEEP.some((re) => re.test(p)),
  });
  const app = path.join(paths[0], "ipackage.app");
  adhocSign(app);
  console.log(`✓ 打包完成：${app}`);
  if (SHARE) makeDmg(app);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
