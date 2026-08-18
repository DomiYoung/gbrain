import { describe, expect, test } from 'bun:test';

import { getRecipe } from '../src/core/ai/recipes/index.ts';

describe('openai-codex recipe registration', () => {
  test('registers the Hermes-compatible OpenAI route', () => {
    const recipe = getRecipe('openai-codex');
    expect(recipe).toBeDefined();
    expect(recipe!.implementation).toBe('openai-compatible');
    expect(recipe!.touchpoints.embedding).toBeUndefined();
    expect(recipe!.touchpoints.expansion?.models).toContain('gpt-5.6-luna');
    expect(recipe!.touchpoints.chat?.models).toContain('gpt-5.4-mini');
    expect(recipe!.touchpoints.chat?.supports_tools).toBe(true);
  });
});
