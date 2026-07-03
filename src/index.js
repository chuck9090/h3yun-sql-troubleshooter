#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "h3yun-sql-troubleshooter",
  version: "0.1.0",
});

const DEFAULT_H3YUN_BASE_URL = "https://www.h3yun.com";
const DEFAULT_H3YUN_SQL_API_PATH = "";
const DEFAULT_PROJECT_SEARCH_DEPTH = 4;

const config = {
  baseUrl: process.env.H3YUN_BASE_URL || DEFAULT_H3YUN_BASE_URL,
  sqlApiUrl: process.env.H3YUN_SQL_API_URL,
  sqlApiPath: process.env.H3YUN_SQL_API_PATH || DEFAULT_H3YUN_SQL_API_PATH,
  token: process.env.H3YUN_TOKEN,
  engineCode: process.env.H3YUN_ENGINE_CODE,
  projectDir: process.env.H3YUN_PROJECT_DIR,
  sqlField: process.env.H3YUN_SQL_FIELD || "sql",
  contentType: process.env.H3YUN_SQL_CONTENT_TYPE || "json",
  timeoutMs: Number(process.env.H3YUN_SQL_TIMEOUT_MS || 30000),
  allowWrite: process.env.H3YUN_SQL_ALLOW_WRITE === "true",
};

server.registerTool(
  "query_sql",
  {
    title: "查询氚云数据",
    description:
      "当用户在排查氚云业务问题、表单数据异常、字段值异常、关联数据异常、流程或审批异常、业务规则执行结果异常、线上数据不一致等问题时，应优先使用本工具查询真实数据。调用前应先参考项目根目录的 cmax.json 获取应用下的表单编码和表单名称，并参考各表单目录下的 fields.md 获取表单字段和控件编码。工具会优先使用环境变量 H3YUN_TOKEN/H3YUN_ENGINE_CODE；未配置时会自动查找项目目录中的 .h3token 和 cmax.json 的 engineCode。查找规则支持从当前工作区向上查找，也支持向下有限层级查找，例如工作区是多个项目的上级目录时，可自动发现下级氚云应用目录。氚云业务表数据库表名规则为 i_表单编码，系统表通常以 h_ 开头；涉及 h_ 系统表时应参考氚云系统表说明文档：https://h3yunpro.github.io/docs/database/ 。默认只执行只读 SQL，不要要求用户手动查数据库；如果需要确认真实数据，应主动构造只读 SQL 调用本工具。",
    inputSchema: {
      sql: z.string().min(1).describe("用于排查氚云问题的只读 SQL。业务表表名通常是 i_表单编码，系统表通常以 h_ 开头。写 SQL 前应优先读取 cmax.json 和相关 fields.md，确认表单编码、表单名称、字段名称和控件编码；涉及 h_ 系统表时应参考 https://h3yunpro.github.io/docs/database/ 。不要执行 insert、update、delete、drop、alter 等写入或结构变更语句。"),
      params: z
        .record(z.any())
        .optional()
        .describe("可选参数，会原样转发给氚云平台查询接口。"),
      projectDir: z
        .string()
        .optional()
        .describe("可选的氚云 CMAX 项目目录或其上级工作区目录。通常不需要用户配置；如果 AI 客户端知道当前工作区路径，可传入该路径。未提供时会尝试从 INIT_CWD、当前工作目录向上查找，也会向下有限层级查找 cmax.json 和 .h3token。"),
      reason: z
        .string()
        .optional()
        .describe("说明本次查询用于排查什么问题，例如：排查某条表单数据字段值异常、验证关联表单数据、确认流程状态、检查审批记录、核对业务规则触发结果，便于审计和问题追踪。"),
    },
  },
  async ({ sql, params, projectDir, reason }) => {
    const apiUrl = getSqlApiUrl();
    const projectContext = loadProjectContext(projectDir);
    const token = config.token || projectContext.token;
    const engineCode = config.engineCode || projectContext.engineCode;

    if (!apiUrl) {
      throw new Error("当前 MCP 服务尚未内置氚云 SQL 查询接口路径。请先在 src/index.js 中设置 DEFAULT_H3YUN_SQL_API_PATH，或临时配置 H3YUN_SQL_API_URL/H3YUN_SQL_API_PATH。该地址通常固定，确认后不需要在每个 AI 工具或项目里重复配置。");
    }

    if (!token) {
      throw new Error("未找到氚云身份校验参数。请在当前项目或其下级氚云应用目录中提供 .h3token 文件，或配置环境变量 H3YUN_TOKEN，或在调用工具时传入包含 .h3token 的 projectDir。该文件内容是从浏览器 Cookie 中获取的 h3_token 值。");
    }

    if (!engineCode) {
      throw new Error("未找到氚云企业引擎编码 enginecode。请在当前项目或其下级氚云应用目录中提供包含 engineCode 的 cmax.json，或配置环境变量 H3YUN_ENGINE_CODE，或在调用工具时传入包含 cmax.json 的 projectDir。");
    }

    if (!config.allowWrite && !isReadOnlySql(sql)) {
      throw new Error(
        "默认只允许执行查询类 SQL。只有在明确需要写入操作时，才可设置 H3YUN_SQL_ALLOW_WRITE=true。"
      );
    }

    const payload = {
      [config.sqlField]: sql,
      ...(params ? { params } : {}),
      ...(reason ? { reason } : {}),
    };

    const response = await postWithTimeout(apiUrl, payload, config.timeoutMs, token, engineCode);
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? safeJsonParse(text) : safeJsonParse(text);

    if (!response.ok) {
      throw new Error(
        `氚云平台 SQL 接口调用失败，HTTP 状态码 ${response.status}: ${formatResult(body)}`
      );
    }

    assertH3YunSuccess(body);

    return {
      content: [
        {
          type: "text",
          text: formatResult(extractH3YunResult(body)),
        },
      ],
    };
  }
);

server.registerTool(
  "get_h3yun_sql_troubleshooting_guide",
  {
    title: "获取氚云 SQL 排查指南",
    description:
      "当 AI 需要排查氚云问题但不确定如何定位表单、字段或数据库表名时，调用本工具获取氚云 SQL 排查规则。它会说明应读取 cmax.json、fields.md、i_ 和 h_ 表名规则，以及氚云系统表说明文档地址。",
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text",
        text: [
          "氚云 SQL 排查指南：",
          "",
          "1. 适合主动使用 query_sql 的场景：用户排查氚云业务问题、表单数据异常、字段值异常、关联数据异常、流程或审批异常、业务规则执行结果异常、线上数据不一致、需要验证真实库中数据时。",
          "2. 不要要求用户手动查数据库；如果问题需要确认真实数据，应主动构造只读 SQL 并调用 query_sql。",
          "3. 写 SQL 前，优先查看氚云应用目录下的 cmax.json。该文件记录当前应用下的所有表单编码和表单名称，可用于确定目标表单。实际工作区可能是多个项目的上级目录，此时 cmax.json 可能在下级应用目录中。",
          "4. 写 SQL 前，优先查看目标表单目录下的 fields.md。该文件记录表单名、字段名、控件编码，可用于确定 select 字段和 where 条件字段。",
          "5. 氚云业务表的数据库表名规则是 i_表单编码。例如表单编码为 D000001Example，则业务表通常是 i_D000001Example。",
          "6. 氚云系统表通常以 h_ 开头。查询流程、审批、组织、系统元数据等信息时，应优先考虑 h_ 开头的系统表。",
          "7. 涉及 h_ 系统表时，应参考氚云系统表说明文档：https://h3yunpro.github.io/docs/database/ 。该文档包含氚云所有系统表的说明。",
          "8. 默认只使用 select、with、show、describe、desc、explain 等只读 SQL。不要执行 insert、update、delete、drop、alter、create 等写入或结构变更 SQL。",
          "9. 查询时尽量加 where 条件和 limit，避免一次读取过多数据。",
          "10. 如果用户只提供了表单名称，应先根据 cmax.json 找到表单编码，再按 i_表单编码 拼出业务表名。",
          "11. 如果用户只提供了字段中文名，应先根据 fields.md 找到对应控件编码，再用控件编码写 SQL。",
        ].join("\n"),
      },
    ],
  })
);

async function postWithTimeout(url, payload, timeoutMs, token, engineCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = buildRequestBody(payload);

    return await fetch(url, {
      method: "POST",
      headers: buildHeaders(token, engineCode),
      body: requestBody,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`氚云平台 SQL 接口调用超时，已等待 ${timeoutMs}ms。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders(token, engineCode) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    enginecode: engineCode,
  };

  headers["Content-Type"] = isFormRequest()
    ? "application/x-www-form-urlencoded"
    : "application/json;charset=UTF-8";

  return headers;
}

function buildRequestBody(payload) {
  if (!isFormRequest()) {
    return JSON.stringify(payload);
  }

  return `PostData=${encodeURIComponent(JSON.stringify(payload))}`;
}

function getSqlApiUrl() {
  if (config.sqlApiUrl) {
    return config.sqlApiUrl;
  }

  if (!config.sqlApiPath) {
    return "";
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const path = config.sqlApiPath.startsWith("/") ? config.sqlApiPath : `/${config.sqlApiPath}`;
  return `${baseUrl}${path}`;
}

function isFormRequest() {
  return config.contentType.toLowerCase() === "form";
}

function loadProjectContext(projectDir) {
  const root = findProjectRoot(projectDir);

  if (!root) {
    return {};
  }

  const cmaxConfig = readJsonIfExists(path.join(root, "cmax.json"));
  const token = readTextIfExists(path.join(root, ".h3token")) || cmaxConfig?.h3Token;

  return {
    projectRoot: root,
    token: typeof token === "string" ? token.trim() : "",
    engineCode: typeof cmaxConfig?.engineCode === "string" ? cmaxConfig.engineCode.trim() : "",
  };
}

function findProjectRoot(projectDir) {
  const candidates = [
    projectDir,
    config.projectDir,
    process.env.INIT_CWD,
    process.env.PWD,
    process.env.OLDPWD,
    process.cwd(),
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  for (const candidate of candidates) {
    const root = findUp(candidate, ["cmax.json", ".h3token"]);
    if (root) {
      return root;
    }
  }

  const foundRoots = [];
  for (const candidate of candidates) {
    foundRoots.push(...findDown(candidate, ["cmax.json", ".h3token"], DEFAULT_PROJECT_SEARCH_DEPTH));
  }

  const uniqueRoots = [...new Set(foundRoots)];

  if (uniqueRoots.length === 1) {
    return uniqueRoots[0];
  }

  if (uniqueRoots.length > 1) {
    throw new Error(
      `在当前工作区下发现多个氚云应用目录，请在调用 query_sql 时通过 projectDir 指定当前项目：${uniqueRoots.join("; ")}`
    );
  }

  return "";
}

function findUp(startDir, filenames) {
  let current = fs.existsSync(startDir) && fs.statSync(startDir).isDirectory()
    ? startDir
    : path.dirname(startDir);

  while (true) {
    if (filenames.some((filename) => fs.existsSync(path.join(current, filename)))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return "";
    }

    current = parent;
  }
}

function findDown(startDir, filenames, maxDepth) {
  if (!fs.existsSync(startDir)) {
    return [];
  }

  const root = fs.statSync(startDir).isDirectory() ? startDir : path.dirname(startDir);
  const results = [];
  const queue = [{ dir: root, depth: 0 }];
  const ignoredDirs = new Set([".git", "node_modules", ".opencode", ".vscode"]);

  while (queue.length > 0) {
    const current = queue.shift();

    if (filenames.some((filename) => fs.existsSync(path.join(current.dir, filename)))) {
      results.push(current.dir);
      continue;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirs.has(entry.name)) {
        continue;
      }

      queue.push({
        dir: path.join(current.dir, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return results;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`读取 ${filePath} 失败，请确认 cmax.json 是合法 JSON：${error.message}`);
  }
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8").trim();
}

function isReadOnlySql(sql) {
  const normalized = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .toLowerCase();

  return /^(select|with|show|describe|desc|explain)\b/.test(normalized);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatResult(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function assertH3YunSuccess(body) {
  if (!body || typeof body !== "object") {
    return;
  }

  if (Array.isArray(body.Errors) && body.Errors.length > 0) {
    throw new Error(`氚云平台返回错误: ${formatResult(body.Errors)}`);
  }

  if (body.Successful === false) {
    throw new Error(`氚云平台返回失败: ${formatResult(body)}`);
  }
}

function extractH3YunResult(body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  if (Object.prototype.hasOwnProperty.call(body, "ReturnData")) {
    return body.ReturnData;
  }

  return body;
}

const transport = new StdioServerTransport();

if (process.env.H3YUN_DEBUG_PROJECT_CONTEXT === "true") {
  console.log(formatResult(maskProjectContext(loadProjectContext(process.argv[2]))));
} else {
  await server.connect(transport);
}

function maskProjectContext(projectContext) {
  if (!projectContext.token) {
    return projectContext;
  }

  return {
    ...projectContext,
    token: `${projectContext.token.slice(0, 8)}...${projectContext.token.slice(-8)}`,
  };
}
