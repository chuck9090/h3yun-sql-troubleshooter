#!/usr/bin/env node
// 把源码编译成单文件可执行程序（Node SEA，Single Executable Application）。
// 产出的程序不再需要安装 Node 或 npm 依赖，可直接作为 MCP 的 command 使用。
//
// 用法：node build/build-sea.mjs
// 产物：dist/h3yun-sql-troubleshooter-<平台>-<架构>[.exe]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inject } from "postject";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const bundlePath = path.join(distDir, "index.cjs");
const seaConfigPath = path.join(distDir, "sea-config.json");
const blobPath = path.join(distDir, "sea-prep.blob");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

const platform = process.platform;
const arch = process.arch;
const exeName = `h3yun-sql-troubleshooter-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
const exePath = path.join(distDir, exeName);
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

// 1. 打包成单个 CommonJS 文件，把 @modelcontextprotocol/sdk、zod 等依赖全部内联。
await build({
  entryPoints: [path.join(rootDir, "src/index.js")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: bundlePath,
  legalComments: "none",
  logLevel: "info",
  banner: { js: `// ${packageJson.name} v${packageJson.version}` },
});

// 2. 生成 SEA 配置并制作注入用的 blob。
fs.writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: path.relative(rootDir, bundlePath).split(path.sep).join("/"),
      output: path.relative(rootDir, blobPath).split(path.sep).join("/"),
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  )
);

execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath], {
  cwd: rootDir,
  stdio: "inherit",
});

// 3. 复制当前 Node 运行时作为程序外壳，再把 blob 注入进去。
fs.copyFileSync(process.execPath, exePath);

if (platform === "darwin") {
  // macOS 上签名会让注入失败，需要先移除签名，注入后再重新做 ad-hoc 签名。
  try {
    execFileSync("codesign", ["--remove-signature", exePath], { stdio: "inherit" });
  } catch {
    // 未签名或没有 codesign 时忽略。
  }
}

await inject(exePath, "NODE_SEA_BLOB", fs.readFileSync(blobPath), {
  sentinelFuse: SEA_FUSE,
  ...(platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
});

if (platform === "darwin") {
  execFileSync("codesign", ["--sign", "-", exePath], { stdio: "inherit" });
}

fs.chmodSync(exePath, 0o755);
fs.rmSync(blobPath, { force: true });
fs.rmSync(seaConfigPath, { force: true });

const sizeMb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`已生成可执行程序：${path.relative(rootDir, exePath)}（${sizeMb} MB，${os.type()} ${arch}）`);
