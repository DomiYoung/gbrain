import type { Recipe } from '../types.ts';
import { AIConfigError } from '../errors.ts';

/**
 * Hermes OpenAI-Codex route through the Ziggie Airouter OpenAI-compatible API.
 *
 * This is deliberately a first-class recipe rather than an alias to `openai`:
 * the endpoint and credential are different, and provider registration must be
 * visible to model resolution, doctor, and every gateway touchpoint.
 */
const API_KEY_ENV = 'HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY';

const CODEX_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.4-mini',
];

export const openaiCodex: Recipe = {
  id: 'openai-codex',
  name: 'OpenAI Codex (Ziggie Airouter)',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://airouter.ziggie.cn/v1',
  auth_env: {
    required: [API_KEY_ENV],
    optional: ['ZIGGIE_API_KEY'],
    setup_url: 'https://hermes-agent.nousresearch.com/docs',
  },
  resolveAuth(env) {
    const token = env[API_KEY_ENV] ?? env.ZIGGIE_API_KEY;
    if (!token) {
      throw new AIConfigError(
        `${API_KEY_ENV} is required for the openai-codex provider.`,
        'Load the canonical Hermes environment (`/Users/light/.hermes/scripts/gbrain_env.sh`) or configure the provider credential through the Hermes credential path.',
      );
    }
    return { headerName: 'Authorization', token: `Bearer ${token}` };
  },
  touchpoints: {
    expansion: {
      models: CODEX_MODELS,
      price_last_verified: '2026-08-18',
    },
    chat: {
      models: CODEX_MODELS,
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: true,
      supports_structured_outputs: true,
      max_context_tokens: 200_000,
      price_last_verified: '2026-08-18',
    },
  },
  setup_hint:
    'Use the Hermes credential path for HERMES_PROVIDER_ZIGGIE_AIROUTER_API_KEY and set `provider_base_urls.openai-codex` only when overriding the default Airouter endpoint.',
};
