import type { Recipe } from '../types.ts';

/**
 * OpenAI-compatible Codex route used by the Hermes Airouter configuration.
 *
 * This is intentionally separate from the native `openai` recipe: Hermes
 * authenticates this route as `openai-codex` and sends chat-completions traffic
 * through the configured OpenAI-compatible base URL. The model list is
 * descriptive; the resolver permits provider-side model IDs not listed here.
 * Chat and expansion share the same route. Embeddings remain on the separately
 * configured embedding provider.
 */
export const openaiCodex: Recipe = {
  id: 'openai-codex',
  name: 'OpenAI Codex (compatible route)',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://api.openai.com/v1',
  auth_env: {
    required: ['OPENAI_API_KEY'],
    optional: ['OPENAI_ORG_ID', 'OPENAI_PROJECT'],
    setup_url: 'https://platform.openai.com/api-keys',
  },
  touchpoints: {
    expansion: {
      models: ['gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-4o-mini'],
      cost_per_1m_tokens_usd: undefined,
      price_last_verified: '2026-08-17',
    },
    chat: {
      models: ['gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-4o-mini'],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      supports_structured_outputs: false,
      max_context_tokens: 200000,
      cost_per_1m_input_usd: undefined,
      cost_per_1m_output_usd: undefined,
      price_last_verified: '2026-08-17',
    },
  },
  setup_hint:
    'Set OPENAI_API_KEY and provider_base_urls.openai-codex to the OpenAI-compatible endpoint used by the Hermes Airouter route.',
};
