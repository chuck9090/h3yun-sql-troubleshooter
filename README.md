# h3yun-sql-troubleshooter

一个用于查询氚云 SQL 数据的 MCP 工具。`h3yun` 是氚云平台的英文标识。AI 或其他 MCP 客户端可以调用 `query_sql` 工具，把 SQL 发送到氚云平台接口，由平台执行后返回查询结果；辅助 AI 排查氚云业务问题是它的扩展使用场景。

本项目的接口调用方式参考了氚云项目同步工具的请求约定：默认氚云地址为 `https://www.h3yun.com`，鉴权使用 `Authorization: Bearer h3_token`，并通过请求头 `EngineCode` 传入企业引擎编码。

如果当前氚云应用项目目录下存在 `.h3token` 和 `cmax.json`，MCP 会自动读取它们：

- `.h3token`：保存氚云接口身份校验参数。MCP 会把它作为不透明 Token 使用，不解析其中的用户信息。
- `cmax.json`：其中的 `engineCode` 是氚云企业引擎编码。

如果调用 MCP 时没有找到这些文件，也没有配置对应环境变量，工具会提示用户提供 Token 或 engineCode。

MCP 不要求 AI 工具全局配置固定项目目录。实际工作区可以是氚云应用目录本身，也可以是它的上级目录。例如：

```text
C:\workspace\h3yun-projects
└── 示例应用(a12345)
    ├── cmax.json
    └── .h3token
```

如果 AI 当前工作区是 `h3yun-projects`，工具会向下有限层级自动发现 `示例应用(a12345)` 这个氚云应用目录。如果同一个工作区下发现多个氚云应用目录，工具会提示 AI 在调用 `query_sql` 时通过 `projectDir` 指定当前项目。

## 功能

- 通过 MCP stdio 协议提供工具给 AI 客户端调用。
- 暴露 `query_sql` 工具，用于执行只读 SQL 查询氚云数据。
- 暴露 `get_h3yun_sql_troubleshooting_guide` 工具，用于辅助 AI 根据项目文件定位表单、字段和数据库表。
- 默认使用内置的氚云平台 SQL 接口地址，确认接口路径后不需要在 AI 工具里重复配置。
- 未配置鉴权环境变量时，可自动读取项目目录下的 `.h3token` 和 `cmax.json.engineCode`。
- 默认只允许 `select`、`with`、`show`、`describe`、`desc`、`explain` 等查询类 SQL。
- 用户未指定查询条数时，`select`/`with` 查询会默认限制为 20 条以内。

## AI 使用规则

本 MCP 的核心用途是查询氚云 SQL 数据。当用户需要查看氚云数据，或排查氚云业务问题、表单数据异常、字段值异常、关联数据异常、流程或审批异常、业务规则执行结果异常、线上数据不一致时，AI 应主动考虑使用本 MCP 查询真实数据，而不是要求用户手动查数据库。

氚云数据库是 MySQL。AI 构造 SQL 时应按 MySQL 语法编写，例如使用 `LIMIT` 控制返回行数。用户未指定要查多少条数据时，MCP 会对 `select`/`with` 查询默认追加 `LIMIT 20`。

传给接口的 SQL 末尾不要加分号，因为平台拿到 SQL 后会在外层再包一层查询。MCP 会自动移除 SQL 末尾的分号，并在需要时追加默认 `LIMIT 20`，但 AI 在生成 SQL 时也应避免添加分号。

在构造 SQL 前，AI 应优先参考当前项目中的这些文件：

- 项目根目录的 `cmax.json`：记录整个应用下的所有表单编码和表单名称。
- 各表单目录下的 `fields.md`：记录表单名、字段名、控件编码等字段信息。
- 项目根目录的 `.h3token`：记录氚云接口身份校验参数。

这里的“项目根目录”指包含 `cmax.json` 和 `.h3token` 的氚云应用目录。AI 当前打开的工作区可以是该目录的上级目录，MCP 会自动向下搜索。

`cmax.json` 中的 `engineCode` 是氚云企业引擎编码，MCP 可直接读取并作为请求头 `enginecode` 使用。

氚云数据库表名规则：

- 业务表名通常是 `i_表单编码`。
- 系统表通常以 `h_` 开头。

涉及 `h_` 系统表时，AI 应优先参考氚云系统表说明文档：

https://h3yunpro.github.io/docs/database/

该文档包含氚云所有系统表的说明，可用于确认流程、审批、组织、系统元数据等系统表的用途和字段含义。

如果用户只提供了表单名称，应先通过 `cmax.json` 找到表单编码，再按 `i_表单编码` 拼出业务表名。如果用户只提供了字段中文名，应先通过对应表单的 `fields.md` 找到控件编码，再构造 SQL。

## 安装

```bash
npm install
```

## 本地启动

```bash
npx h3yun-sql-troubleshooter
```

PowerShell 示例：

```powershell
npx h3yun-sql-troubleshooter
```

正常使用时不需要在 AI 工具里配置项目目录。AI 在不同项目上工作时，可以把当前工作区路径作为 `projectDir` 传给 `query_sql`；如果没有传入，工具会尝试从当前进程工作目录向上查找，也会向下有限层级搜索 `cmax.json` 和 `.h3token`。

如果项目目录下没有 `.h3token` 或 `cmax.json`，才需要通过环境变量临时提供：

```powershell
$env:H3YUN_TOKEN="your-h3-token"
$env:H3YUN_ENGINE_CODE="your-engine-code"
npx h3yun-sql-troubleshooter
```

如果氚云 SQL 接口路径发生变化，才需要临时覆盖接口地址：

```powershell
$env:H3YUN_SQL_API_URL="https://www.h3yun.com/your-sql-api-path"
npx h3yun-sql-troubleshooter
```

## MCP 客户端配置示例

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

如果当前包还没有发布到 npm，也可以在本机开发目录中这样配置：

```json
{
  "mcpServers": {
    "h3yun-sql-troubleshooter": {
      "command": "node",
      "args": ["D:/ai/test/h3yun-sql-troubleshooter/src/index.js"]
    }
  }
}
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `H3YUN_BASE_URL` | 否 | `https://www.h3yun.com` | 氚云平台基础地址 |
| `H3YUN_SQL_API_URL` | 否 | 内置默认地址 | 完整 SQL 查询接口地址；仅接口地址变化时覆盖 |
| `H3YUN_SQL_API_PATH` | 否 | 内置默认路径 | SQL 查询接口路径；未配置 `H3YUN_SQL_API_URL` 时会和 `H3YUN_BASE_URL` 拼接 |
| `H3YUN_REPORTING_ACTION_URL` | 否 | 内置默认地址 | 报表 `CheckSQL` 接口完整地址；仅接口地址变化时覆盖 |
| `H3YUN_REPORTING_ACTION_PATH` | 否 | `/Console/Reporting/OnAction` | 报表 `CheckSQL` 接口路径 |
| `H3YUN_PROJECT_DIR` | 否 | 自动发现 | 氚云应用项目目录或其上级目录。通常不需要配置，优先由 AI 调用工具时传入当前工作区路径 |
| `H3YUN_TOKEN` | 条件必填 | 自动读取 `.h3token` | 氚云接口身份校验 Token |
| `H3YUN_ENGINE_CODE` | 条件必填 | 自动读取 `cmax.json.engineCode` | 氚云企业引擎编码 `enginecode` |
| `H3YUN_SQL_FIELD` | 否 | `sql` | 请求体中 SQL 字段名 |
| `H3YUN_SQL_TIMEOUT_MS` | 否 | `30000` | 请求超时时间 |
| `H3YUN_SQL_ALLOW_WRITE` | 否 | `false` | 是否允许非查询 SQL |

## 氚云平台接口约定

服务会向内置的氚云 SQL 预览接口发送 `POST` 请求，也就是把 AI 生成的 SQL 转发给氚云平台接口执行。默认接口路径：

```text
/rx-report/integrate/data-source/v1/customsql/previewSql
```

只有接口地址变化时，才需要用 `H3YUN_SQL_API_URL` 或 `H3YUN_SQL_API_PATH` 覆盖。

正式执行用户传入的 SQL 前，MCP 会先调用报表 `CheckSQL` 接口查询系统用户 ID。默认接口路径：

```text
/Console/Reporting/OnAction
```

`CheckSQL` 请求体格式为 `application/x-www-form-urlencoded`：

```text
PostData=<encodeURIComponent(JSON.stringify(payload))>
```

脱敏后的 `PostData` 内容：

```json
{
  "ActionName": "CheckSQL",
  "Sql": "select ObjectId from h_user where name='System'",
  "Columns": "[]"
}
```

查到 `System` 用户 `ObjectId` 后，再调用 SQL 预览接口。SQL 预览接口默认请求头：

```http
Accept: application/json, text/plain, */*
Accept-Language: zh-CN
Authorization: Bearer <自动读取的 h3_token>
Content-Type: application/json
EngineCode: <cmax.json.engineCode>
Origin: https://www.h3yun.com
```

`CheckSQL` 请求不传 `UserId` 请求头，也不会解析 `.h3token` 中的用户信息。随后用户真正传入的 SQL 请求体中，`config.userId` 会使用查询到的 `System` 用户 `ObjectId`。

默认请求体：

```json
{
  "sql": "SELECT ObjectId, Name FROM h_user LIMIT 2",
  "corpId": "<engineCode>",
  "config": {
    "userId": "<System 用户 ObjectId>",
    "extra": {
      "icon": "icon-cgfk"
    }
  }
}
```

如果氚云平台接口要求的字段名不是 `sql`，可以通过 `H3YUN_SQL_FIELD` 修改。

## 响应处理

服务会兼容氚云 SQL 预览接口响应结构：

```json
{
  "data": {
    "title": null,
    "data": [
      {
        "ObjectId": "示例数据ID",
        "Name": "示例名称"
      }
    ],
    "headers": [
      {
        "name": "ObjectId",
        "title": "ObjectId",
        "type": "STRING"
      }
    ]
  }
}
```

工具会把该结构整理为：

```json
{
  "rows": [],
  "headers": [],
  "title": null
}
```

同时也兼容氚云其他常见响应结构：

```json
{
  "Successful": true,
  "Errors": [],
  "ReturnData": []
}
```

- 如果 `Errors` 不为空，会作为错误返回给 AI。
- 如果 `Successful` 为 `false`，会作为错误返回给 AI。
- 如果 `success` 为 `false`，会作为错误返回给 AI。
- 如果存在 `ReturnData`，工具结果只返回 `ReturnData`。
- 如果存在 `data.data`，工具结果返回 `rows`、`headers`、`title`。
- 如果不存在 `ReturnData`，工具结果返回完整响应。

## 工具入参

`query_sql` 支持：

```json
{
  "sql": "select * from orders where id = 'xxx'",
  "params": {
    "traceId": "optional"
  },
  "projectDir": "D:/workspace/h3yun-app",
  "reason": "说明为什么要查这条 SQL"
}
```

`projectDir` 是可选参数，可以传氚云应用目录，也可以传它的上级工作区目录。未传入时，工具会依次尝试从 `H3YUN_PROJECT_DIR`、`INIT_CWD`、当前工作目录查找；查找方式包括向上查找和向下有限层级搜索 `cmax.json`、`.h3token`。

不建议在 AI 工具的全局 MCP 配置中写死 `projectDir`，因为你可能同时处理多个氚云项目。更好的方式是由 AI 在调用工具时传入当前项目工作区路径。

`get_h3yun_sql_troubleshooting_guide` 不需要入参，返回固定的氚云 SQL 排查指南。
