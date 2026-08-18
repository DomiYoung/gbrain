import { describe, expect, test } from 'bun:test';
import { getRecipe } from '../../src/core/ai/recipes/index.ts';
import { resolveRecipe } from '../../src/core/ai/model-resolver.ts';

describe('recipe: openai-codex', () => {
  test('is statically registered as the official OpenAI Responses provider', () => {
    const recipe = getRecipe('openai-codex');
    expect(recipe).toBeDefined();
    expect(recipe!.tier).toBe('native');
    expect(recipe!.implementation).toBe('native-openai');
    expect(recipe!.base_url_default).toBe('https://chatgpt.com/backend-api/codex');
  });

  test('resolves configured Codex model ids through the registry', () => {
    const resolved = resolveRecipe('openai-codex:gpt-5.6-luna');
    expect(resolved.parsed.providerId).toBe('openai-codex');
    expect(resolved.parsed.modelId).toBe('gpt-5.6-luna');
    expect(resolved.recipe.id).toBe('openai-codex');
    expect(resolved.recipe.touchpoints.chat?.models).toContain('gpt-5.6-luna');
  });

  test('does not declare Ziggie or OpenAI API-key auth', () => {
    const recipe = getRecipe('openai-codex')!;
    expect(recipe.auth_env?.required).toEqual([]);
    expect(recipe.auth_env?.optional).toContain('HERMES_OAUTH_FILE');
    expect(recipe.resolveAuth).toBeUndefined();
  });
});
