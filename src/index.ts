#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { runLarkCli, type CommandIntent } from './cli.js';
import { agentGuide, commandModel, securityGuide, skillsText } from './context.js';

const serverInfo = {
  name: 'feishu-cli-mcp',
  version: '0.1.0'
};

const resultShape = {
  ok: z.boolean(),
  exitCode: z.number().nullable(),
  command: z.string(),
  args: z.array(z.string()),
  stdout: z.string(),
  stderr: z.string(),
  json: z.unknown().nullable(),
  truncated: z.boolean(),
  risk: z.string(),
  nextSteps: z.array(z.string())
};

function buildServer() {
  const server = new McpServer(serverInfo);

  server.registerTool(
    'lark_cli_run',
    {
      title: 'Run lark-cli command',
      description:
        'Run the official lark-cli with argv-style arguments. Use schema/help first. ' +
        'Set intent=write or auth_config for side-effect commands; those require confirm=true.',
      inputSchema: {
        args: z.array(z.string()).min(1).describe(
          'Arguments after lark-cli, e.g. ["calendar","+agenda","--format","json"].'
        ),
        intent: z.enum(['read', 'write', 'auth_config', 'schema', 'help']).describe(
          'Command risk class. read/schema/help are safe; write/auth_config require confirm=true.'
        ),
        confirm: z.boolean().optional().describe(
          'Required for write/auth_config commands after user approval or dry-run review.'
        ),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
        maxOutputBytes: z.number().int().positive().max(10_485_760).optional()
      },
      outputSchema: resultShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ args, intent, confirm, timeoutMs, maxOutputBytes }) => {
      const output = await runLarkCli({
        args,
        intent: intent as CommandIntent,
        confirm,
        timeoutMs,
        maxOutputBytes
      });
      return toolResult(output);
    }
  );

  server.registerTool(
    'lark_cli_schema',
    {
      title: 'Inspect lark-cli API schema',
      description:
        'Inspect parameters, request body, response shape, supported identities, and scopes. ' +
        'Call this before API commands or risky writes.',
      inputSchema: {
        method: z.string().optional().describe(
          'Optional API method name, e.g. "calendar.events.instance_view". Omit to list schemas.'
        )
      },
      outputSchema: resultShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ method }) => {
      const args = method ? ['schema', method, '--format', 'json'] : ['schema', '--format', 'json'];
      return toolResult(await runLarkCli({ args, intent: 'schema' }));
    }
  );

  server.registerTool(
    'lark_cli_help',
    {
      title: 'Read lark-cli help',
      description:
        'Read help for a service or command. Use before shortcuts because shortcuts are discovered via help.',
      inputSchema: {
        args: z.array(z.string()).optional().describe(
          'Command path before --help, e.g. ["calendar"] or ["im","+messages-send"].'
        )
      },
      outputSchema: resultShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ args }) => {
      return toolResult(await runLarkCli({
        args: [...(args ?? []), '--help'],
        intent: 'help'
      }));
    }
  );

  server.registerTool(
    'lark_cli_auth_status',
    {
      title: 'Check lark-cli auth status',
      description:
        'Check current Feishu/Lark login status, granted scopes, and active identity before calls.',
      inputSchema: {},
      outputSchema: resultShape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () => {
      return toolResult(await runLarkCli({
        args: ['auth', 'status'],
        intent: 'read'
      }));
    }
  );

  registerResources(server);
  registerPrompts(server);
  return server;
}

function registerResources(server: McpServer) {
  const textResource = (uri: string, text: string) => ({
    contents: [{ uri, mimeType: 'text/markdown', text }]
  });

  server.registerResource(
    'lark-agent-guide',
    'lark://agent-guide',
    {
      title: 'Feishu/Lark agent guide',
      description: 'Rules agents should follow when using lark-cli through MCP.',
      mimeType: 'text/markdown'
    },
    async () => textResource('lark://agent-guide', agentGuide)
  );

  server.registerResource(
    'lark-command-model',
    'lark://command-model',
    {
      title: 'lark-cli command model',
      description: 'Shortcut, API command, and raw API decision model.',
      mimeType: 'text/markdown'
    },
    async () => textResource('lark://command-model', commandModel)
  );

  server.registerResource(
    'lark-skills',
    'lark://skills',
    {
      title: 'lark-cli skill domains',
      description: 'Agent-facing domains covered by the official CLI.',
      mimeType: 'text/markdown'
    },
    async () => textResource('lark://skills', `# lark-cli skills\n\n${skillsText()}\n`)
  );

  server.registerResource(
    'lark-security',
    'lark://security',
    {
      title: 'Feishu/Lark MCP security rules',
      description: 'Safety rules for scopes, write commands, HTTP deployment, and Docker state.',
      mimeType: 'text/markdown'
    },
    async () => textResource('lark://security', securityGuide)
  );

  server.registerResource(
    'lark-schema',
    new ResourceTemplate('lark://schema/{method}', { list: undefined }),
    {
      title: 'lark-cli schema by method',
      description: 'Dynamic schema resource. Example: lark://schema/calendar.events.instance_view',
      mimeType: 'application/json'
    },
    async (uri, variables) => {
      const method = String(variables.method ?? '');
      const result = await runLarkCli({
        args: ['schema', method, '--format', 'json'],
        intent: 'schema'
      });
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: result.json ? 'application/json' : 'text/plain',
          text: result.json ? JSON.stringify(result.json, null, 2) : result.stdout || result.stderr
        }]
      };
    }
  );
}

function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'lark_plan_command',
    {
      title: 'Plan a lark-cli command',
      description: 'Ask the agent to choose the safest lark-cli command path before execution.',
      argsSchema: {
        task: z.string().describe('User task to accomplish in Feishu/Lark.')
      }
    },
    async ({ task }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text:
            `Task: ${task}\n\n` +
            'Read lark://agent-guide and lark://command-model. Choose shortcut first, API command second, raw API last. ' +
            'For writes, inspect schema/help, run dry-run when available, then ask for approval.'
        }
      }]
    })
  );

  server.registerPrompt(
    'lark_safe_write',
    {
      title: 'Prepare a safe Feishu/Lark write',
      description: 'Guide the agent through schema, dry-run, and confirmation for side-effect work.',
      argsSchema: {
        command: z.string().describe('Proposed lark-cli command without the lark-cli binary.')
      }
    },
    async ({ command }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text:
            `Proposed command: ${command}\n\n` +
            'Before execution: inspect help/schema, identify scopes and identity, add --dry-run if supported, ' +
            'show the user the planned change, then call lark_cli_run with intent=write and confirm=true only after approval.'
        }
      }]
    })
  );
}

function toolResult(output: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
    structuredContent: output
  };
}

async function main() {
  const transport = getArg('--transport') ?? process.env.MCP_TRANSPORT ?? 'stdio';
  if (transport === 'http') {
    serveHttp();
    return;
  }

  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

function serveHttp() {
  const host = process.env.MCP_HOST ?? '127.0.0.1';
  const port = Number(process.env.MCP_PORT ?? 3333);
  const token = process.env.MCP_HTTP_TOKEN;
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const app = createMcpExpressApp({
    host,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined
  });

  app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
    if (!token) return next();
    const auth = req.header('authorization') ?? '';
    if (auth === `Bearer ${token}`) return next();
    res.status(401).json({ error: 'Missing or invalid MCP_HTTP_TOKEN bearer token.' });
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    } finally {
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
    }
  });

  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ ok: true, name: serverInfo.name, version: serverInfo.version });
  });

  app.listen(port, host, () => {
    console.error(`feishu-cli-mcp listening on http://${host}:${port}/mcp`);
  });
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

await main();
