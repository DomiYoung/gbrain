import type { Recipe } from '../types.ts';

/**
 * cc-vibe.com — OpenAI-compatible proxy for Anthropic Claude models
 * Original provider with Claude support
 */
export const cc_vibe: Recipe = {
  id: 'cc_vibe',
  name: 'CC Vibe Claude',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://cc-vibe.com/v1',
  auth_env: {
    required: ['CC_VIBE_API_KEY'],
    setup_url: 'https://cc-vibe.com',
  },
  touchpoints: {
    chat: {
      models: [
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-opus-4-5-20251101',
        'claude-sonnet-5',
        'claude-sonnet-4-6',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
        'claude-fable-5',
      ],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: true,
      max_context_tokens: 200000,
      cost_per_1m_input_usd: 3.0,
      cost_per_1m_output_usd: 15.0,
      price_last_verified: '2026-07-09',
    },
    expansion: {
      models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
      cost_per_1m_tokens_usd: 0.80,
      price_last_verified: '2026-07-09',
    },
  },
  setup_hint: 'Set CC_VIBE_API_KEY environment variable with your cc-vibe.com API key.',
};
