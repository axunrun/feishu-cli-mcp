import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type CommandIntent = 'read' | 'write' | 'auth_config' | 'schema' | 'help';

export type CliResult = {
  ok: boolean;
  exitCode: number | null;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  json: unknown | null;
  truncated: boolean;
  timedOut: boolean;
  risk: string;
  nextSteps: string[];
};

type RunOptions = {
  args: string[];
  intent: CommandIntent;
  confirm?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

const DEFAULT_TIMEOUT_MS = Number(process.env.LARK_CLI_TIMEOUT_MS ?? 120_000);
const DEFAULT_MAX_OUTPUT_BYTES = Number(process.env.LARK_CLI_MAX_OUTPUT_BYTES ?? 1_048_576);
const require = createRequire(import.meta.url);

export function larkCliBin() {
  return larkCliInvocation().display;
}

function larkCliInvocation() {
  const configuredBin = process.env.LARK_CLI_BIN;
  if (configuredBin) {
    return { command: configuredBin, prefixArgs: [] as string[], display: configuredBin };
  }

  const script = require.resolve('@larksuite/cli/scripts/run.js');
  return {
    command: process.execPath,
    prefixArgs: [script],
    display: `${process.execPath} ${script}`
  };
}

export function classifyRisk(args: string[], intent: CommandIntent) {
  if (intent === 'schema' || intent === 'help' || intent === 'read') return 'read_only';
  if (intent === 'auth_config') return 'auth_or_configuration_change';

  const [first, second] = args;
  if (first === 'api' && /^(POST|PUT|PATCH|DELETE)$/i.test(second ?? '')) {
    return 'open_api_write';
  }
  return 'possible_write';
}

export function needsConfirm(intent: CommandIntent) {
  return intent === 'write' || intent === 'auth_config';
}

export async function runLarkCli(options: RunOptions): Promise<CliResult> {
  const risk = classifyRisk(options.args, options.intent);
  if (needsConfirm(options.intent) && !options.confirm) {
    return {
      ok: false,
      exitCode: null,
      command: larkCliBin(),
      args: options.args,
      stdout: '',
      stderr: '',
      json: null,
      truncated: false,
      timedOut: false,
      risk,
      nextSteps: [
        'For write/auth commands, call lark_cli_schema or lark_cli_help first.',
        'If the CLI command supports it, run the same command with --dry-run.',
        'Call lark_cli_run again with confirm=true only after the user approves.'
      ]
    };
  }

  await prepareCliHome();

  return new Promise((resolve) => {
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const invocation = larkCliInvocation();
    const child = spawn(invocation.command, [...invocation.prefixArgs, ...options.args], {
      cwd: process.env.LARK_CLI_WORKDIR ?? process.cwd(),
      env: buildCliEnv(),
      shell: false
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let settled = false;

    const collect = (current: Buffer, chunk: Buffer) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length <= maxOutputBytes) return next;
      truncated = true;
      return next.subarray(0, maxOutputBytes);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      settled = true;
      resolve(formatResult({
        args: options.args,
        exitCode: null,
        stdout: stdout.toString('utf8'),
        stderr: appendLine(stderr.toString('utf8'), `Timed out after ${timeoutMs}ms.`),
        truncated,
        timedOut: true,
        risk
      }));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = collect(stdout, chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = collect(stderr, chunk);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(formatResult({
        args: options.args,
        exitCode: null,
        stdout: '',
        stderr: error.message,
        truncated,
        timedOut: false,
        risk
      }));
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(formatResult({
        args: options.args,
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        truncated,
        timedOut: false,
        risk
      }));
    });
  });
}

function formatResult(input: {
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  risk: string;
}): CliResult {
  const json = parseJson(input.stdout);
  return {
    ok: input.exitCode === 0,
    exitCode: input.exitCode,
    command: larkCliBin(),
    args: input.args,
    stdout: input.stdout,
    stderr: input.stderr,
    json,
    truncated: input.truncated,
    timedOut: input.timedOut,
    risk: input.risk,
    nextSteps: nextSteps(input.exitCode, input.stderr, json, input.timedOut)
  };
}

function parseJson(stdout: string) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function nextSteps(exitCode: number | null, stderr: string, json: unknown, timedOut: boolean) {
  if (timedOut) {
    return ['If stdout/stderr contains a verification URL, open it in a browser and complete the flow.'];
  }

  if (exitCode === 0) {
    return json === null ? ['Output was not JSON; inspect stdout text.'] : [];
  }

  const text = stderr.toLowerCase();
  if (text.includes('scope') || text.includes('permission')) {
    return ['Run lark_cli_auth_status, then authorize missing scopes with lark-cli auth login.'];
  }
  if (text.includes('login') || text.includes('auth')) {
    return ['Run lark_cli_auth_status. If not logged in, use lark-cli auth login --recommend.'];
  }
  return ['Run lark_cli_help for the service or lark_cli_schema for the API method.'];
}

function appendLine(text: string, line: string) {
  return text ? `${text.replace(/\s+$/, '')}\n${line}` : line;
}

async function prepareCliHome() {
  const home = process.env.LARK_CLI_HOME;
  if (!home) return;
  await mkdir(home, { recursive: true });
  await mkdir(join(home, '.lark-cli'), { recursive: true });
}

function buildCliEnv() {
  const env = { ...process.env };
  const home = process.env.LARK_CLI_HOME;
  if (home) {
    env.HOME = home;
    env.USERPROFILE = home;
    env.LARKSUITE_CLI_CONFIG_DIR = join(home, '.lark-cli');
  }

  if (env.LARKSUITE_CLI_CONFIG_DIR) {
    env.LARKSUITE_CLI_CONFIG_DIR = dirname(join(env.LARKSUITE_CLI_CONFIG_DIR, 'x'));
  }

  return env;
}
