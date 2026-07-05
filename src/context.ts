export const skills = [
  ['lark-shared', 'App config, auth login, identity switching, scope management, security rules.'],
  ['lark-calendar', 'Calendar events, agenda, free/busy, time suggestions, rooms, RSVP.'],
  ['lark-im', 'Messages, group chats, history, search, media, reactions.'],
  ['lark-doc', 'Create, read, update, and search documents.'],
  ['lark-drive', 'Upload/download files, search docs/wiki, comments and permissions.'],
  ['lark-markdown', 'Create, fetch, patch, and overwrite Drive-native Markdown files.'],
  ['lark-sheets', 'Create, read, write, append, find, and export spreadsheets.'],
  ['lark-slides', 'Create and manage presentations and slides.'],
  ['lark-base', 'Base tables, fields, records, views, dashboards, workflows, analytics.'],
  ['lark-task', 'Tasks, task lists, subtasks, reminders, assignment.'],
  ['lark-mail', 'Browse, search, read, send, reply, forward, drafts, watch mail.'],
  ['lark-contact', 'Search users and get user profiles.'],
  ['lark-wiki', 'Knowledge spaces, nodes, and documents.'],
  ['lark-event', 'WebSocket event subscriptions and regex routing.'],
  ['lark-vc', 'Meeting records and minutes artifacts.'],
  ['lark-minutes', 'Minutes metadata, summary, todos, chapters, media.'],
  ['lark-approval', 'Approval tasks, approve/reject/transfer/cancel/CC.'],
  ['lark-okr', 'OKRs, objectives, key results, alignment, progress.']
];

export const agentGuide = `# Feishu/Lark CLI MCP agent guide

Use these tools as a context protocol, not as a raw shell.

Decision order:
1. Read lark://command-model and lark://skills when choosing a domain.
2. Prefer shortcut commands like "calendar +agenda" for common work.
3. Use API commands when a shortcut does not cover the task.
4. Use raw "api METHOD /open-apis/..." only when the API command is unavailable.
5. Before any write/auth/config command, inspect schema/help and get user approval.
6. If lark-cli help marks a command high-risk-write, include the CLI-required confirmation flag after user approval.

Identity:
- Add "--as user" for user-context operations.
- Add "--as bot" for bot-context operations.
- If a command fails for scopes, call lark_cli_auth_status and ask the user to authorize.

Output:
- Prefer "--format json" for machine-readable results.
- Use table/pretty only when the user asks for human display.
- Use "lark_cli_run" with args ["skills","list"] or ["skills","read", "..."] for embedded official skill text.
`;

export const commandModel = `# lark-cli command model

The official CLI exposes three layers:

1. Shortcuts
   - Shape: lark-cli <service> +<shortcut> [flags]
   - Best for agents.
   - Many write shortcuts support "--dry-run".
   - Some high-risk writes also require the CLI's own confirmation flag.

2. API commands
   - Shape: lark-cli <service> <resource> <method> --params '{...}'
   - Maps curated Open Platform APIs to commands.
   - Inspect with "lark-cli schema <service.resource.method>".

3. Raw API
   - Shape: lark-cli api METHOD /open-apis/path --params '{...}' --data '{...}'
   - Full coverage fallback.
   - Treat POST/PUT/PATCH/DELETE as write operations.
`;

export const securityGuide = `# Security rules

- lark_cli_run never invokes a shell; arguments are passed as an argv array.
- write and auth_config intents require confirm=true.
- For write operations, run schema/help first and prefer --dry-run before confirm=true.
- Remote HTTP deployments should set MCP_HTTP_TOKEN.
- Persist Docker state by mounting /data/lark-cli.
- Do not grant broad scopes unless the user explicitly approves.
`;

export function skillsText() {
  return skills.map(([name, description]) => `- ${name}: ${description}`).join('\n');
}
