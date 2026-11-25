#!/usr/bin/env node
// 冒烟测试：启动编译好的可执行程序，完成一次 MCP 初始化握手并检查工具列表。
// 用法：node build/smoke-test.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const executableName = fs
  .readdirSync(distDir)
  .find((name) => name.startsWith("h3yun-sql-troubleshooter-") && !name.endsWith(".cjs"));
const exePath = path.join(distDir, executableName || "");

if (!executableName || !fs.existsSync(exePath)) {
  console.error("未找到编译产物，请先执行 npm run build");
  process.exit(1);
}

const child = spawn(exePath, [], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
let errorOutput = "";
let done = false;

const timeout = setTimeout(() => {
  finish(1, `冒烟测试超时：可执行程序未在 20 秒内返回工具列表。\n${errorOutput}`);
}, 20000);

function finish(code, message) {
  if (done) {
    return;
  }
  done = true;
  clearTimeout(timeout);
  child.kill();
  if (code === 0) {
    console.log(message);
  } else {
    console.error(message);
  }
  process.exit(code);
}

child.on("error", (error) => finish(1, `无法启动可执行程序：${error.message}`));
child.on("exit", (code) => finish(1, `可执行程序提前退出（退出码 ${code}）。\n${errorOutput}`));
child.stderr.on("data", (chunk) => {
  errorOutput += chunk.toString();
});

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();

  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    newlineIndex = buffer.indexOf("\n");

    if (!line) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.id === 2) {
      const toolNames = message.result?.tools?.map((tool) => tool.name) || [];
      if (toolNames.includes("query_sql")) {
        finish(0, `冒烟测试通过：${executableName} 可用，工具列表 = ${toolNames.join(", ")}`);
      }
      finish(1, `冒烟测试失败：工具列表中缺少 query_sql。\n${line}`);
    }
  }
});

const requests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
];

for (const request of requests) {
  child.stdin.write(`${JSON.stringify(request)}\n`);
}
