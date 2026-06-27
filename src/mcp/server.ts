import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { BrainEngine } from '../core/engine.ts';
import { operations } from '../core/operations.ts';
import { VERSION } from '../version.ts';
import { buildToolDefs } from './tool-defs.ts';
import { dispatchToolCall, validateParams, buildOperationContext } from './dispatch.ts';
import { getBrainHotMemoryMeta } from '../core/facts/meta-hook.ts';
import { loadConfig } from '../core/config.ts';
import {
  resolveSocketPath,
  startResolveIpcServer,
  cleanupStaleSocket,
} from '../core/context/resolve-ipc.ts';
import { resolveEntitiesToPointers, logDeliveredReflexPointers } from '../core/context/retrieval-reflex.ts';
import { resolveSourceId } from '../core/source-resolver.ts';

export async function startMcpServer(engine: BrainEngine) {
  const server = new Server(
    { name: 'gbrain', version: VERSION },
    { capabilities: { tools: {} } },
  );

  // Generate tool definitions from operations. Extracted to buildToolDefs so
  // the subagent tool registry (v0.15+) can call the same mapper against a
  // filtered OPERATIONS subset instead of duplicating this shape.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolDefs(operations),
  }));

  // Dispatch tool calls via shared dispatch.ts (parity with HTTP transport).
  // MCP stdio callers are remote/untrusted; dispatch defaults remote=true.
  // The MCP SDK's response type widened in 1.29 to allow a managed-task wrapper;
  // gbrain ops are synchronous, so we return the legacy `{ content, isError? }`
  // shape and cast through `any` (the SDK accepts it via the ServerResult union).
  server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<any> => {
    const { name, arguments: params } = request.params;
    // v0.28: stdio MCP has no per-token auth (local pipe). Default remains
    // ['world'] so generic agent-facing callers don't see private hunches.
    // Operators can explicitly widen the local trusted MCP surface via
    // GBRAIN_TAKES_HOLDERS_ALLOWLIST=world,brain without changing code.
    const holdersAllowList = (process.env.GBRAIN_TAKES_HOLDERS_ALLOWLIST ?? 'world')
      .split(',')
      .map(h => h.trim())
      .filter(Boolean);
    // v0.42 (CTO fix 2026-06-19): MCP source resolution now matches CLI
    // behavior — walks the full 6-tier chain (--source flag, GBRAIN_SOURCE env,
    // .gbrain-source dotfile, local_path, brain default, 'default' fallback)
    // instead of only checking GBRAIN_SOURCE. Closes the governance gap where
    // all MCP writes fell to 'default' source regardless of dotfile/brain config.
    const sourceId = await resolveSourceId(engine, null).catch(() => 'default');
    return dispatchToolCall(engine, name, params, {
      remote: true,
      takesHoldersAllowList: holdersAllowList.length > 0 ? holdersAllowList : ['world'],
      sourceId,
      // v0.31 (eD3): _meta.brain_hot_memory injection so Claude Desktop /
      // Code see the brain's relevant hot memory automatically alongside
      // every tool-call response. Best-effort; absorbs errors.
      metaHook: getBrainHotMemoryMeta,
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Retrieval Reflex (#1981, D9=C): on a PGLite brain, serve owns the single
  // connection, so the context engine resolves salient entities THROUGH us over
  // a local unix socket rather than opening a second (impossible) connection.
  // Best-effort; failure to bind never blocks the MCP server.
  let resolveServer: import('node:net').Server | null = null;
  let resolveSocket: string | null = null;
  try {
    const cfg = loadConfig();
    if (cfg?.engine === 'pglite' && cfg.database_path) {
      resolveSocket = resolveSocketPath(cfg.database_path);
      // v0.42 (CTO fix 2026-06-19): use the same resolveSourceId as tool calls
      const defaultSource = await resolveSourceId(engine, null).catch(() => 'default');
      resolveServer = await startResolveIpcServer(
        resolveSocket,
        (req) =>
          resolveEntitiesToPointers(
            engine,
            req.sourceId || defaultSource,
            req.candidates ?? [],
            {
              priorContextText: req.priorContextText,
              maxPointers: req.maxPointers,
              suppression: req.suppression,
            },
          ),
        // The IPC resolve path IS the ambient reflex channel. Logging happens
        // at DELIVERY (post-write), not inside the resolver — a block the
        // client's 250ms budget abandoned was never injected, and counting it
        // would corrupt the volunteered-vs-used precision stats (red-team).
        (block) => logDeliveredReflexPointers(engine, block.pointers),
      );
    }
  } catch {
    /* resolve IPC is best-effort; never block serve */
  }

  // Exit cleanly when MCP client disconnects (stdin EOF) or on signals.
  // Without this, orphaned serve processes accumulate and contend for the
  // PGLite write lock, causing ingest jobs (email-sync) to time out.
  let shuttingDown = false;
  const shutdown = (reason: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[gbrain-serve] shutdown: ${reason}\n`);
    try { resolveServer?.close(); } catch { /* noop */ }
    if (resolveSocket) cleanupStaleSocket(resolveSocket);
    Promise.resolve(engine.disconnect?.())
      .catch(() => {})
      .finally(() => process.exit(code));
  };
  // v0.34.1 (#870): when MCP_STDIO=1, the wrapping gateway (OpenClaw's
  // bundle-mcp layer, others) often pipes the JSON-RPC handshake then
  // closes its stdin half. Treating that as a permanent disconnect kills
  // the server before the first tool call arrives. Signal handlers and
  // transport.onclose still cover the legitimate shutdown paths.
  if (process.env.MCP_STDIO !== '1') {
    process.stdin.on('end', () => shutdown('stdin end'));
    process.stdin.on('close', () => shutdown('stdin close'));
  }
  // @ts-ignore — SDK exposes onclose on transport
  transport.onclose = () => shutdown('transport close');
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

// Backward compat: used by `gbrain call` command (trusted local path).
// v0.31.8 (D22): accept opts.sourceId so `gbrain call --source X <op> <json>`
// can scope the op handler to that source. resolveSourceId() in call.ts is
// the upstream resolver; this layer just passes the resolved id through.
export async function handleToolCall(
  engine: BrainEngine,
  tool: string,
  params: Record<string, unknown>,
  opts?: { sourceId?: string },
): Promise<unknown> {
  const op = operations.find(o => o.name === tool);
  if (!op) throw new Error(`Unknown tool: ${tool}`);

  const validationError = validateParams(op, params);
  if (validationError) throw new Error(validationError);

  const ctx = buildOperationContext(engine, params, {
    remote: false,
    logger: { info: console.log, warn: console.warn, error: console.error },
    ...(opts?.sourceId ? { sourceId: opts.sourceId } : {}),
  });

  return op.handler(ctx, params);
}
