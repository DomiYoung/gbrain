import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gbrainPath } from '../config.ts';

interface ChatPacerState {
  last_started_ms?: number;
  provider_id?: string;
  model_id?: string;
  min_interval_ms?: number;
}

export interface PaceChatStartOpts {
  providerId: string;
  modelId: string;
  abortSignal?: AbortSignal;
}

export function resolveChatMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GBRAIN_CHAT_MIN_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function sanitizePacerKey(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'unknown';
}

function pacerDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GBRAIN_CHAT_PACER_DIR;
  return configured && configured.trim().length > 0
    ? configured
    : gbrainPath('runtime', 'chat-pacer');
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' ? reason : 'aborted');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted|abort/i.test(err.message));
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function acquireLock(lockDir: string, minIntervalMs: number, signal?: AbortSignal): Promise<() => Promise<void>> {
  const staleAfterMs = Math.max(30_000, minIntervalMs * 4);
  for (;;) {
    throwIfAborted(signal);
    try {
      await mkdir(lockDir);
      return async () => { await rm(lockDir, { recursive: true, force: true }); };
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      try {
        const s = await stat(lockDir);
        if (Date.now() - s.mtimeMs > staleAfterMs) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (statErr: any) {
        if (statErr?.code !== 'ENOENT') throw statErr;
      }
      await sleep(Math.min(250, Math.max(25, Math.floor(minIntervalMs / 10))), signal);
    }
  }
}

async function readState(path: string): Promise<ChatPacerState> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ChatPacerState;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return {};
    return {};
  }
}

async function writeStateAtomic(path: string, state: ChatPacerState): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state)}\n`, 'utf8');
  await rename(tmp, path);
}

/**
 * Cross-process provider-level pacing for real chat provider calls.
 *
 * This is intentionally keyed by provider, not model: providers usually share
 * one quota bucket across `v4-pro`/`v4-flash` style model variants. Holding the
 * tiny lock while sleeping serializes all gbrain workers on the same provider,
 * which prevents overnight cycle/dream/subagent batches from hammering an API
 * every few seconds after a miss or quota failure.
 */
export async function paceChatStart(opts: PaceChatStartOpts): Promise<void> {
  const minIntervalMs = resolveChatMinIntervalMs();
  if (minIntervalMs <= 0) return;

  const key = sanitizePacerKey(opts.providerId);
  const dir = pacerDir();
  const statePath = join(dir, `${key}.json`);
  const lockDir = join(dir, `${key}.lock`);

  let release: (() => Promise<void>) | null = null;
  try {
    await mkdir(dir, { recursive: true });
    release = await acquireLock(lockDir, minIntervalMs, opts.abortSignal);
    const state = await readState(statePath);
    const last = Number.isFinite(state.last_started_ms) ? Number(state.last_started_ms) : 0;
    const waitMs = Math.max(0, last + minIntervalMs - Date.now());
    if (waitMs > 0) await sleep(waitMs, opts.abortSignal);
    await writeStateAtomic(statePath, {
      last_started_ms: Date.now(),
      provider_id: opts.providerId,
      model_id: opts.modelId,
      min_interval_ms: minIntervalMs,
    });
  } catch (err) {
    // Abort is the caller's control signal; preserve it. Filesystem/pacer
    // failures are not allowed to make the AI gateway unavailable.
    if (isAbortLike(err)) throw err;
    process.stderr.write(`[gbrain] chat pacer disabled for this call: ${(err as Error).message}\n`);
  } finally {
    if (release) {
      try { await release(); } catch { /* best effort */ }
    }
  }
}

export const __testing = {
  pacerDir,
};
