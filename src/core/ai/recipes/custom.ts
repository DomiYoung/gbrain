import type { Recipe } from '../types.ts';

/**
 * Custom OpenAI-compatible provider (e.g. NewAPI, LiteLLM proxy, any
 * OpenAI-compatible endpoint). Resolves via provider_base_urls config.
 */
export const custom: Recipe = {
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  auth_env: {
    required: ['NEWAPI_API_KEY'],
    optional: ['CUSTOM_BASE_URL'],
  },
  touchpoints: {
    chat: {
      models: ['gpt-5.5', 'claude-opus-4-7', 'claude-sonnet-4-6'],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      max_context_tokens: 200000,
      cost_per_1m_input_usd: 3.0,
      cost_per_1m_output_usd: 15.0,
    },
  },
  setup_hint: 'Set newapi_api_key in gbrain config and provider_base_urls["custom"] to your endpoint.',
};
