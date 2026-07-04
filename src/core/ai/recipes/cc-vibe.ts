import type { Recipe } from '../types.ts';

export const cc_vibe: Recipe = {
  id: 'cc_vibe',
  name: 'CC Vibe Claude',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://cc-vibe.com/v1',
  auth_env: {
    required: ['CC_VIBE_API_KEY'],
    optional: [],
  },
  touchpoints: {
    chat: {
      models: ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-6'],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      max_context_tokens: 200000,
      cost_per_1m_input_usd: 3.0,
      cost_per_1m_output_usd: 15.0,
    },
  },
  setup_hint: 'Custom provider for cc-vibe.com claude API',
};
