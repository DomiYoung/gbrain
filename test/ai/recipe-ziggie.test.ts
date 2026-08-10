import { describe, expect, test } from 'bun:test';
import { applyOpenAICompatConfig, defaultResolveAuth } from '../../src/core/ai/gateway.ts';
import { getRecipe, listRecipes } from '../../src/core/ai/recipes/index.ts';
import { deepseekReasoningContentCompatFetch } from '../../src/core/ai/recipes/deepseek.ts';

const ZIGGIE_BASE_URL = 'https://airouter.ziggie.cn/v1';

describe('ziggie recipe', () => {
  test('is registered as a first-class OpenAI-compatible provider', () => {
    const ids = listRecipes().map((r) => r.id);
    expect(ids).toContain('ziggie');

    const r = getRecipe('ziggie')!;
    expect(r.name).toBe('Ziggie Airouter');
    expect(r.tier).toBe('openai-compat');
    expect(r.implementation).toBe('openai-compatible');
    expect(r.base_url_default).toBe(ZIGGIE_BASE_URL);
    expect(r.auth_env?.required).toEqual(['ZIGGIE_API_KEY']);
    expect(r.auth_env?.optional).toContain('HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY');
  });

  test('declares the priced DeepSeek V4 models used by GBrain extraction', () => {
    const r = getRecipe('ziggie')!;
    expect(r.touchpoints.expansion?.models).toEqual(['deepseek-v4-flash']);
    expect(r.touchpoints.chat?.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(r.touchpoints.chat?.supports_tools).toBe(true);
    expect(r.touchpoints.chat?.supports_subagent_loop).toBe(true);
  });

  test('uses the DeepSeek reasoning_content compatibility shim', () => {
    const r = getRecipe('ziggie')!;
    const resolved = applyOpenAICompatConfig(r, { env: { ZIGGIE_API_KEY: 'sk-ziggie' } } as any);
    expect(resolved.baseURL).toBe(ZIGGIE_BASE_URL);
    expect(resolved.fetch).toBe(deepseekReasoningContentCompatFetch);
  });

  test('default auth reads ZIGGIE_API_KEY as bearer token', () => {
    const r = getRecipe('ziggie')!;
    expect(defaultResolveAuth(r, { ZIGGIE_API_KEY: 'sk-ziggie' }, 'chat')).toEqual({
      headerName: 'Authorization',
      token: 'Bearer sk-ziggie',
    });
  });
});
