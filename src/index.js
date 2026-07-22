#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "h3yun-sql-troubleshooter",
  version: "1.0.1",
});

const DEFAULT_H3YUN_BASE_URL = "https://www.h3yun.com";
const DEFAULT_H3YUN_SQL_API_PATH = "/rx-report/integrate/data-source/v1/customsql/previewSql";
const DEFAULT_H3YUN_REPORTING_ACTION_PATH = "/Console/Reporting/OnAction";
const DEFAULT_PROJECT_SEARCH_DEPTH = 4;
const DEFAULT_QUERY_LIMIT = 20;
const SYSTEM_USER_SQL = "select ObjectId from h_user where name='System'";

const config = {
  baseUrl: process.env.H3YUN_BASE_URL || DEFAULT_H3YUN_BASE_URL,
  sqlApiUrl: process.env.H3YUN_SQL_API_URL,
  sqlApiPath: process.env.H3YUN_SQL_API_PATH || DEFAULT_H3YUN_SQL_API_PATH,
  reportingActionUrl: process.env.H3YUN_REPORTING_ACTION_URL,
  reportingActionPath: process.env.H3YUN_REPORTING_ACTION_PATH || DEFAULT_H3YUN_REPORTING_ACTION_PATH,
  sqlField: process.env.H3YUN_SQL_FIELD || "sql",
  timeoutMs: Number(process.env.H3YUN_SQL_TIMEOUT_MS || 30000),
  allowWrite: process.env.H3YUN_SQL_ALLOW_WRITE === "true",
};

server.registerTool(
  "query_sql",
  {
    title: "查询氚云数据",
    description:
      "用于查询氚云 SQL 数据，也可辅助 AI 排查氚云业务问题、表单数据异常、字段值异常、关联数据异常、流程或审批异常、业务规则执行结果异常、线上数据不一致等问题。氚云数据库是 MySQL，构造 SQL 时应按 MySQL 语法编写。氚云接口实测只支持以 select 或 with 开头的查询；show、describe、desc、explain 会因接口在 SQL 外层包装查询而执行失败。传给接口的 SQL 末尾不要加分号。用户未指定查询条数时，select/with 查询会默认限制为 20 条以内。调用本工具时，AI 必须通过 projectDir 传入当前 Agent 所在的工作区目录。MCP 只会在该目录及其下级有限层级内查找 .h3token 和 cmax.json，不会向上查找，不会读取当前进程目录、用户目录或环境变量中的项目路径和凭据。写 SQL 前应参考 cmax.json 获取表单编码和表单名称，并参考各表单目录下的 fields.md 获取字段和控件编码。氚云业务表数据库表名规则为 i_表单编码，系统表通常以 h_ 开头；涉及 h_ 系统表时应参考氚云系统表说明文档：https://h3yunpro.github.io/docs/database/ 。默认只执行只读 SQL，不要要求用户手动查数据库；如果需要确认真实数据，应主动构造只读 SQL 调用本工具。",
    inputSchema: {
      sql: z.string().min(1).describe("用于查询氚云数据的只读 SQL，也可用于排查氚云问题。只允许以 select 或 with 开头；show、describe、desc、explain 经氚云接口实测无法执行。氚云数据库是 MySQL，应使用 MySQL 语法。SQL 末尾不要加分号，因为平台会在外层再包一层查询。用户未指定查询条数时，select/with 查询会默认限制为 20 条以内。业务表表名通常是 i_表单编码，系统表通常以 h_ 开头。写 SQL 前应优先读取 cmax.json 和相关 fields.md，确认表单编码、表单名称、字段名称和控件编码；涉及 h_ 系统表时应参考 https://h3yunpro.github.io/docs/database/ 。不要执行 insert、update、delete、drop、alter 等写入或结构变更语句。"),
      params: z
        .record(z.any())
        .optional()
        .describe("可选参数，会原样转发给氚云平台查询接口。"),
      projectDir: z
        .string()
        .min(1)
        .describe("必填。AI 调用工具时必须传入当前 Agent 所在工作区目录的绝对路径。MCP 只在该目录及其下级有限层级内查找 cmax.json 和 .h3token，不会访问其上级目录、当前进程目录、用户目录或环境变量中的项目路径。"),
      reason: z
        .string()
        .optional()
        .describe("说明本次查询用于排查什么问题，例如：排查某条表单数据字段值异常、验证关联表单数据、确认流程状态、检查审批记录、核对业务规则触发结果，便于审计和问题追踪。"),
    },
  },
  async ({ sql, params, projectDir, reason }) => {
    const apiUrl = getSqlApiUrl();
    const projectContext = loadProjectContext(projectDir);
    const token = projectContext.token;
    const engineCode = projectContext.engineCode;

    if (!apiUrl) {
      throw new Error("当前 MCP 服务尚未内置氚云 SQL 查询接口路径。请先在 src/index.js 中设置 DEFAULT_H3YUN_SQL_API_PATH，或临时配置 H3YUN_SQL_API_URL/H3YUN_SQL_API_PATH。该地址通常固定，确认后不需要在每个 AI 工具或项目里重复配置。");
    }

    if (!token) {
      throw new Error(
        `在指定目录及其下级目录中未找到 .h3token。${formatProjectDirectoryHint(projectDir)} `
        + "请让用户提供 .h3token 和 cmax.json 所在目录，再将该目录作为 projectDir 重新调用。本文件内容是从浏览器 Cookie 中获取的 h3_token 值。"
      );
    }

    if (!engineCode) {
      throw new Error(
        `在指定目录及其下级目录中未找到包含 engineCode 的 cmax.json。${formatProjectDirectoryHint(projectDir)} `
        + "请让用户提供 .h3token 和 cmax.json 所在目录，再将该目录作为 projectDir 重新调用。"
      );
    }

    if (!config.allowWrite && !isReadOnlySql(sql)) {
      throw new Error(
        "默认只允许执行以 select 或 with 开头的查询。show、describe、desc、explain 经氚云接口实测无法执行。只有在明确需要写入操作时，才可设置 H3YUN_SQL_ALLOW_WRITE=true。"
      );
    }

    const normalizedSql = normalizeSqlForH3Yun(sql);
    const userId = await resolveExecutionUserId(token, engineCode);
    const payload = buildSqlPayload(normalizedSql, params, reason, engineCode, userId);

    const response = await postWithTimeout(apiUrl, payload, config.timeoutMs, token, engineCode, userId);
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
      "当 AI 需要查询氚云 SQL 数据或排查氚云问题，但不确定如何定位表单、字段或数据库表名时，调用本工具获取氚云 SQL 查询规则。它会说明应读取 cmax.json、fields.md、i_ 和 h_ 表名规则，以及氚云系统表说明文档地址。",
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text",
        text: [
          "氚云 SQL 排查指南：",
          "",
          "1. query_sql 的核心用途是查询氚云 SQL 数据；当用户需要查看真实库数据，或排查氚云业务问题、表单数据异常、字段值异常、关联数据异常、流程或审批异常、业务规则执行结果异常、线上数据不一致时，也适合主动使用。",
          "2. 不要要求用户手动查数据库；如果问题需要确认真实数据，应主动构造只读 SQL 并调用 query_sql。",
          "3. 调用 query_sql 时必须把当前 Agent 所在的工作区目录作为 projectDir 传入。MCP 只在该目录及其下级有限层级内查找 .h3token 和 cmax.json，不使用环境变量或其他隐式目录。",
          "4. 氚云数据库是 MySQL，构造 SQL 时应按 MySQL 语法编写，例如使用 LIMIT 控制返回行数；如果用户未指定要查多少条，query_sql 会对 select/with 查询默认追加 LIMIT 20。",
          "5. 传给接口的 SQL 末尾不要加分号，因为平台拿到 SQL 后会在外层再包一层查询。",
          "6. 写 SQL 前，优先查看氚云应用目录下的 cmax.json。该文件记录当前应用下的所有表单编码和表单名称，可用于确定目标表单。实际工作区可能是多个项目的上级目录，此时 cmax.json 可能在下级应用目录中。",
          "7. 写 SQL 前，优先查看目标表单目录下的 fields.md。该文件记录表单名、字段名、控件编码，可用于确定 select 字段和 where 条件字段。",
          "8. 氚云业务表的数据库表名规则是 i_表单编码。例如表单编码为 D000001Example，则业务表通常是 i_D000001Example。",
          "9. 氚云系统表通常以 h_ 开头。查询流程、审批、组织、系统元数据等信息时，应优先考虑 h_ 开头的系统表。",
          "10. 涉及 h_ 系统表时，应参考氚云系统表说明文档：https://h3yunpro.github.io/docs/database/ 。该文档包含氚云所有系统表的说明。",
          "11. 只使用以 select 或 with 开头的查询。show、describe、desc、explain 经氚云接口实测会因外层查询包装而执行失败。不要执行 insert、update、delete、drop、alter、create 等写入或结构变更 SQL。",
          "12. 查询时尽量加 where 条件和 limit，避免一次读取过多数据；未指定 limit 时默认最多查询 20 条。",
          "13. 如果用户只提供了表单名称，应先根据 cmax.json 找到表单编码，再按 i_表单编码 拼出业务表名。",
          "14. 如果用户只提供了字段中文名，应先根据 fields.md 找到对应控件编码，再用控件编码写 SQL。",
        ].join("\n"),
      },
    ],
  })
);

async function postWithTimeout(url, payload, timeoutMs, token, engineCode, userId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "POST",
      headers: buildHeaders(token, engineCode, userId),
      body: JSON.stringify(payload),
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

async function postFormWithTimeout(url, payload, timeoutMs, token, engineCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: "POST",
      headers: buildReportingHeaders(token, engineCode),
      body: `PostData=${encodeURIComponent(JSON.stringify(payload))}`,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`氚云报表 SQL 校验接口调用超时，已等待 ${timeoutMs}ms。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders(token, engineCode, userId) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN",
    Authorization: `Bearer ${token}`,
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    EngineCode: engineCode,
    Origin: config.baseUrl,
    Pragma: "no-cache",
  };

  return headers;
}

function buildReportingHeaders(token, engineCode) {
  const headers = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Authorization: `Bearer ${token}`,
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    EngineCode: engineCode,
    Origin: config.baseUrl,
    Pragma: "no-cache",
    "X-Requested-With": "XMLHttpRequest",
  };

  return headers;
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

function getReportingActionUrl() {
  if (config.reportingActionUrl) {
    return config.reportingActionUrl;
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const path = config.reportingActionPath.startsWith("/")
    ? config.reportingActionPath
    : `/${config.reportingActionPath}`;
  return `${baseUrl}${path}`;
}

function buildSqlPayload(sql, params, reason, engineCode, userId) {
  return {
    [config.sqlField]: sql,
    corpId: engineCode,
    config: {
      userId,
      extra: {
        icon: "icon-cgfk",
      },
    },
    ...(params ? { params } : {}),
    ...(reason ? { reason } : {}),
  };
}

async function resolveExecutionUserId(token, engineCode) {
  const payload = {
    ActionName: "CheckSQL",
    Sql: SYSTEM_USER_SQL,
    Columns: "[]",
  };
  const response = await postFormWithTimeout(getReportingActionUrl(), payload, config.timeoutMs, token, engineCode);
  const text = await response.text();
  const body = safeJsonParse(text);

  if (!response.ok) {
    throw new Error(`查询 System 用户 ID 失败，HTTP 状态码 ${response.status}: ${formatResult(body)}`);
  }

  assertH3YunSuccess(body);

  const rows = body?.ReturnData?.rows;
  const systemUserId = Array.isArray(rows) && rows.length > 0 ? rows[0]?.objectid || rows[0]?.ObjectId : "";

  if (!systemUserId) {
    throw new Error(`未查询到 System 用户 ID，请确认 SQL 可执行：${SYSTEM_USER_SQL}`);
  }

  return systemUserId;
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
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new Error("调用 query_sql 时必须通过 projectDir 传入当前 Agent 所在的工作区目录。");
  }

  if (!path.isAbsolute(projectDir)) {
    throw new Error(`projectDir 必须是绝对路径，不能基于当前 MCP 执行目录解析相对路径：${projectDir}`);
  }

  const root = path.resolve(projectDir);

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`projectDir 必须是当前 Agent 所在的有效工作区目录：${root}`);
  }

  const projectRoot = selectProjectRoot(findDown(root, ["cmax.json", ".h3token"], DEFAULT_PROJECT_SEARCH_DEPTH));

  if (!projectRoot) {
    throw new Error(
      `在指定目录及其下级 ${DEFAULT_PROJECT_SEARCH_DEPTH} 层内未找到 .h3token 或 cmax.json。${formatProjectDirectoryHint(root)} `
      + "请让用户提供这两个文件所在目录，再将该目录作为 projectDir 重新调用。"
    );
  }

  return projectRoot;
}

function formatProjectDirectoryHint(projectDir) {
  return `已搜索目录：${path.resolve(projectDir)}。当前 MCP 执行目录：${process.cwd()}。`;
}

function selectProjectRoot(roots) {
  const uniqueRoots = [...new Set(roots)];
  const completeRoots = uniqueRoots.filter(hasCompleteProjectContext);

  if (completeRoots.length === 1) {
    return completeRoots[0];
  }

  if (completeRoots.length > 1) {
    throwMultipleProjectRoots(completeRoots);
  }

  if (uniqueRoots.length === 1) {
    return uniqueRoots[0];
  }

  if (uniqueRoots.length > 1) {
    throwMultipleProjectRoots(uniqueRoots);
  }

  return "";
}

function hasCompleteProjectContext(root) {
  const cmaxConfig = readJsonIfExists(path.join(root, "cmax.json"));
  const hasToken = Boolean(readTextIfExists(path.join(root, ".h3token")) || cmaxConfig?.h3Token);
  const hasEngineCode = Boolean(cmaxConfig?.engineCode);
  return hasToken && hasEngineCode;
}

function throwMultipleProjectRoots(roots) {
  throw new Error(
    `在当前工作区下发现多个氚云应用目录，请在调用 query_sql 时通过 projectDir 指定当前项目：${roots.join("; ")}`
  );
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

  return /^(select|with)\b/.test(normalized);
}

function normalizeSqlForH3Yun(sql) {
  const normalized = sql.trim().replace(/;+\s*$/g, "");

  if (!shouldApplyDefaultLimit(normalized)) {
    return normalized;
  }

  return `${normalized} LIMIT ${DEFAULT_QUERY_LIMIT}`;
}

function shouldApplyDefaultLimit(sql) {
  const normalized = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .toLowerCase();

  return /^(select|with)\b/.test(normalized) && !/\blimit\b/.test(normalized);
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

  if (body.success === false) {
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

  if (body.data && typeof body.data === "object" && Array.isArray(body.data.data)) {
    return {
      rows: body.data.data,
      headers: body.data.headers || [],
      title: body.data.title || null,
    };
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
