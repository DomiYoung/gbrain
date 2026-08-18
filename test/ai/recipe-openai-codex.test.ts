import { describe, expect, test } from 'bun:test';
import { getRecipe } from '../../src/core/ai/recipes/index.ts';
import { resolveRecipe } from '../../src/core/ai/model-resolver.ts';

const TOKEN = 'test-airouter-token';

describe('recipe: openai-codex', () => {
  test('is statically registered as an OpenAI-compatible provider', () => {
    const recipe = getRecipe('openai-codex');
    expect(recipe).toBeDefined();
    expect(recipe!.tier).toBe('openai-compat');
    expect(recipe!.implementation).toBe('openai-compatible');
    expect(recipe!.base_url_default).toBe('https://airouter.ziggie.cn/v1');
  });

  test('resolves configured Codex model ids through the registry', () => {
    const resolved = resolveRecipe('openai-codex:gpt-5.6-luna');
    expect(resolved.parsed.providerId).toBe('openai-codex');
    expect(resolved.parsed.modelId).toBe('gpt-5.6-luna');
    expect(resolved.recipe.id).toBe('openai-codex');
    expect(resolved.recipe.touchpoints.chat?.models).toContain('gpt-5.6-luna');
  });

  test('uses the canonical Hermes credential and never falls back to OpenAI auth', () => {
    const recipe = getRecipe('openai-codex')!;
    expect(recipe.resolveAuth!({ HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY: TOKEN })).toEqual({
      headerName: 'Authorization',
      token: `Bearer ${TOKEN}`,
    });
    expect(() => recipe.resolveAuth!({ OPENAI_API_KEY: 'unrelated-openai-key' })).toThrow(
      'HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY',
    );
  });
});
