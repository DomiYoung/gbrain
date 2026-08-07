import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withEnv } from '../helpers/with-env.ts';
import { paceChatStart, resolveChatMinIntervalMs, sanitizePacerKey } from '../../src/core/ai/chat-pacer.ts';

describe('chat pacer', () => {
  test('parses positive interval and treats empty/invalid as disabled', () => {
    expect(resolveChatMinIntervalMs({ GBRAIN_CHAT_MIN_INTERVAL_MS: '50' } as NodeJS.ProcessEnv)).toBe(50);
    expect(resolveChatMinIntervalMs({ GBRAIN_CHAT_MIN_INTERVAL_MS: '' } as NodeJS.ProcessEnv)).toBe(0);
    expect(resolveChatMinIntervalMs({ GBRAIN_CHAT_MIN_INTERVAL_MS: 'nope' } as NodeJS.ProcessEnv)).toBe(0);
    expect(resolveChatMinIntervalMs({} as NodeJS.ProcessEnv)).toBe(0);
  });

  test('sanitizes provider keys for filesystem state files', () => {
    expect(sanitizePacerKey('Ziggie Airouter')).toBe('ziggie-airouter');
    expect(sanitizePacerKey('')).toBe('unknown');
  });

  test('spaces consecutive starts for the same provider across callers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-chat-pacer-'));
    try {
      await withEnv({ GBRAIN_CHAT_MIN_INTERVAL_MS: '45', GBRAIN_CHAT_PACER_DIR: dir }, async () => {
        const t0 = Date.now();
        await paceChatStart({ providerId: 'ziggie', modelId: 'deepseek-v4-pro' });
        const t1 = Date.now();
        await paceChatStart({ providerId: 'ziggie', modelId: 'deepseek-v4-flash' });
        const t2 = Date.now();

        expect(t1 - t0).toBeLessThan(40);
        expect(t2 - t1).toBeGreaterThanOrEqual(35);
        const state = JSON.parse(readFileSync(join(dir, 'ziggie.json'), 'utf8'));
        expect(state.provider_id).toBe('ziggie');
        expect(state.model_id).toBe('deepseek-v4-flash');
        expect(state.min_interval_ms).toBe(45);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
