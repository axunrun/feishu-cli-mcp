# feishu-cli-mcp

把官方 `lark-cli` 暴露成 MCP 服务，让 Agent 通过清晰的上下文协议使用飞书/ Lark CLI 的完整能力。

## 设计

本项目不重写飞书 API，也不手工封装 200+ CLI 命令。MCP 只做一层受控代理：

- `lark_cli_run`：执行任意 `lark-cli` 参数数组，覆盖 CLI 全部能力。
- `lark_cli_schema`：查询 API 方法参数、响应、身份和 scopes。
- `lark_cli_help`：查询服务或命令帮助，发现快捷命令。
- `lark_cli_auth_status`：检查登录、scope 和身份状态。

Agent 上下文通过 MCP Resources / Prompts 暴露：

- `lark://agent-guide`：Agent 使用规则。
- `lark://command-model`：快捷命令、API 命令、Raw API 的选择顺序。
- `lark://skills`：官方 CLI 覆盖的业务域。
- `lark://security`：写操作、scope、Docker 和 HTTP 安全规则。
- `lark://schema/{method}`：动态读取某个 API 方法 schema。
- `lark_plan_command`：让 Agent 先规划命令。
- `lark_safe_write`：让 Agent 走 schema、dry-run、用户确认流程。

## Agent 协议

Agent 必须按这个顺序使用：

1. 读 `lark://agent-guide` 和 `lark://command-model`。
2. 优先查 `lark_cli_help`，选择 `+shortcut`。
3. 快捷命令不够时，用 `lark_cli_schema` 查 API 命令。
4. API 命令不够时，才用 `lark_cli_run` 调 raw `api METHOD /open-apis/...`。
5. 读操作用 `intent=read`。
6. 写操作用 `intent=write`，先 help/schema，能 dry-run 就先 dry-run。
7. `intent=write` 或 `intent=auth_config` 必须传 `confirm=true`，否则服务拒绝执行。
8. 机器读取优先加 `--format json`。

示例：

```json
{
  "tool": "lark_cli_run",
  "arguments": {
    "args": ["calendar", "+agenda", "--format", "json"],
    "intent": "read"
  }
}
```

写操作示例：

```json
{
  "tool": "lark_cli_run",
  "arguments": {
    "args": ["im", "+messages-send", "--chat-id", "oc_xxx", "--text", "hello", "--dry-run"],
    "intent": "write",
    "confirm": true
  }
}
```

## 本地运行

```bash
npm install
npm run build
node dist/index.js --transport stdio
```

HTTP：

```bash
copy .env.example .env
npm run build
node dist/index.js --transport http
```

MCP URL：

```text
http://127.0.0.1:3333/mcp
```

如果设置了 `MCP_HTTP_TOKEN`，客户端需要传：

```http
Authorization: Bearer <token>
```

## Docker / Unraid

```bash
cp .env.example .env
docker compose up -d --build
```

Unraid 模板关键配置：

- Repository/Image: `feishu-cli-mcp:latest` 或你的 GitHub 镜像地址
- WebUI / MCP URL: `http://<unraid-ip>:3333/mcp`
- Port: `3333:3333`
- Volume: `/mnt/user/appdata/feishu-cli-mcp/lark-cli:/data/lark-cli`
- Env:
  - `MCP_TRANSPORT=http`
  - `MCP_HOST=0.0.0.0`
  - `MCP_PORT=3333`
  - `MCP_HTTP_TOKEN=<强随机 token>`
  - `LARK_CLI_HOME=/data/lark-cli`

持久化点是 `/data/lark-cli`。这里保存 CLI 配置和授权状态。

## 初始化飞书授权

容器启动后，通过 MCP 执行：

```json
{
  "tool": "lark_cli_run",
  "arguments": {
    "args": ["config", "init", "--new"],
    "intent": "auth_config",
    "confirm": true
  }
}
```

然后登录：

```json
{
  "tool": "lark_cli_run",
  "arguments": {
    "args": ["auth", "login", "--recommend", "--no-wait"],
    "intent": "auth_config",
    "confirm": true
  }
}
```

把 CLI 输出里的授权 URL 发给用户完成浏览器授权。

## 验证

```bash
npm run check
docker compose up -d --build
curl http://127.0.0.1:3333/healthz
```
