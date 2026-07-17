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
- `cmax.json`：其中的 `engineCode` 是氚云企业引擎编码。

推荐把这两个文件放在氚云应用项目目录下。AI 调用工具时可以传入 `projectDir`，也可以让工具从当前工作区自动向上或向下查找。

示例目录：

```text
C:\workspace\h3yun-projects
└── 示例应用(a12345)
    ├── cmax.json
    └── .h3token
```

如果当前工作区下有多个氚云应用目录，AI 应在调用 `query_sql` 时通过 `projectDir` 指定目标项目。

如果不想放文件，也可以通过环境变量提供：

```text
H3YUN_TOKEN=<h3_token>
H3YUN_ENGINE_CODE=<engineCode>
```

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

- 只允许 `select`、`with`、`show`、`describe`、`desc`、`explain` 等查询类 SQL。
- SQL 末尾的分号会自动移除。
- 用户未指定查询条数时，`select`/`with` 查询会默认追加 `LIMIT 20`。
- 氚云业务表通常是 `i_表单编码`，系统表通常以 `h_` 开头。

### get_h3yun_sql_troubleshooting_guide

返回给 AI 使用的氚云 SQL 查询指南，说明如何根据 `cmax.json`、`fields.md`、业务表和系统表规则定位表单、字段和数据库表名。

## 实现约定

工具默认调用氚云平台内置接口：

- SQL 预览接口：`/rx-report/integrate/data-source/v1/customsql/previewSql`
- 报表校验接口：`/Console/Reporting/OnAction`

正式执行用户 SQL 前，工具会先通过报表校验接口查询 `System` 用户的 `ObjectId`，再用该用户上下文调用 SQL 预览接口。

请求头使用：

- `Authorization: Bearer <h3_token>`
- `EngineCode: <engineCode>`
- `Origin: https://www.h3yun.com`

## AI 使用建议

AI 在查询前应优先读取项目中的：

- `cmax.json`：确认表单名称和表单编码。
- `fields.md`：确认字段名称和控件编码。

涉及系统表时，应参考氚云系统表说明文档：

https://h3yunpro.github.io/docs/database/

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE)（仅限第 3 版）许可。
