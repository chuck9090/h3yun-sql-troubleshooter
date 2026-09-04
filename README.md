# h3yun-sql-troubleshooter

一个给 AI 使用的氚云 SQL 查询 MCP 工具。AI 可以调用 `query_sql`，把只读 SQL 发送到氚云平台接口执行，并拿到真实数据结果；辅助排查氚云业务问题是它的典型使用场景之一。

## MCP 配置

已发布到 npm 时，推荐这样配置：

```json
{
  "mcpServers": {
    "h3yun-sql-troubleshooter": {
      "command": "npx",
      "args": ["h3yun-sql-troubleshooter"]
    }
  }
}
```

如果使用本机开发目录，可以直接指向入口文件：

```json
{
  "mcpServers": {
    "h3yun-sql-troubleshooter": {
      "command": "node",
      "args": ["D:/ai/mcps/h3yun-sql-troubleshooter/src/index.js"]
    }
  }
}
```

## 凭据准备

工具需要两个氚云参数：

- `.h3token`：保存从浏览器 Cookie 中取得的 `h3_token` 值。
- `cmax.json`：位于“氚云代码”目录根部，使用 `version: 2` 和 `apps` 结构；根对象记录所有应用共用的 `engineCode`、`h3yunApiVersion` 和 `systemUserId`，`apps` 记录各应用信息。

新版 `h3yun-cmax` 将 `.h3token` 和 `cmax.json` 统一保存到“氚云代码”目录；应用目录下不再保存 `cmax.json`。AI 调用 `query_sql` 时必须通过 `projectDir` 传入当前 Agent 所在工作区目录或“氚云代码”目录的绝对路径。

如果 `projectDir` 本身就是“氚云代码”目录,MCP 只检查当前目录；否则只检查 `projectDir` 的直接子目录中是否有“氚云代码”目录。找到后必须同时存在 `.h3token` 和根 `cmax.json`,否则立即停止查询。MCP 不会搜索更上级、更下级或其他名称目录,也不会使用当前进程目录或环境变量中的项目路径、token、engineCode。根配置包含多个应用时,应确保传入的当前目录能够唯一确定目标应用。

如果没有找到“氚云代码”目录或凭据文件,错误信息会显示已检查的 `projectDir` 和当前 MCP 执行目录。当前 MCP 执行目录仅用于帮助用户判断目录是否传错,不会被用于搜索。AI 应让用户提供工作区目录或“氚云代码”目录,并将该目录作为新的 `projectDir` 重新调用。

示例目录：

```text
C:\workspace\h3yun-projects
└── 氚云代码
    ├── .h3token
    ├── cmax.json
    └── 示例应用(a1a2b3c)
```

如果当前氚云代码目录下有多个应用,执行 SQL 时可直接将 `projectDir` 设为“氚云代码”目录,因为认证参数统一读取根 `cmax.json`。如果需要根据应用配置定位具体表单或字段,再将 `projectDir` 设为目标应用目录。

## 工具

### query_sql

执行氚云只读 SQL 查询。

入参示例：

```json
{
  "sql": "select ObjectId, Name from h_user limit 5",
  "projectDir": "D:/workspace/h3yun-app",
  "reason": "查询用户基础信息"
}
```

行为规则：

- `projectDir` 必填,值为当前工作区目录或“氚云代码”目录的绝对路径。
- 如果 `projectDir` 是“氚云代码”目录,只检查当前目录；否则只检查直接下一层的“氚云代码”目录。该目录必须同时存在根 `cmax.json` 和 `.h3token`。
- 只允许以 `select` 或 `with` 开头的查询。实测 `show`、`describe`、`desc`、`explain` 会因氚云接口在 SQL 外层包装查询而执行失败。
- SQL 末尾的分号会自动移除。
- 用户未指定查询条数时，`select`/`with` 查询会默认追加 `LIMIT 20`。
- 氚云业务表通常是 `i_表单编码`，系统表通常以 `h_` 开头。

### get_h3yun_sql_troubleshooting_guide

返回给 AI 使用的氚云 SQL 查询指南，说明如何根据 `cmax.json`、`fields.md`、业务表和系统表规则定位表单、字段和数据库表名。

## 实现约定

工具默认调用氚云平台内置接口：

- SQL 预览接口：`/rx-report/integrate/data-source/v1/customsql/previewSql`
正式执行用户 SQL 前，工具优先读取根 `cmax.json` 中共享的 `systemUserId`；如果缺少该字段，会先通过报表接口查询 `System` 用户的 `ObjectId`，再用该用户上下文调用 SQL 预览接口。

请求头使用：

- `Authorization: Bearer <h3_token>`
- `EngineCode: <engineCode>`
- `Origin: https://www.h3yun.com`

## AI 使用建议

AI 在查询前应优先读取项目中的：

- `cmax.json`：确认表单名称和表单编码，并读取根级共享的 `engineCode`、`systemUserId`。
- `fields.md`：确认字段名称和控件编码。

涉及系统表时，应参考氚云系统表说明文档：

https://h3yunpro.github.io/docs/database/

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)（仅限第 3 版）许可。
