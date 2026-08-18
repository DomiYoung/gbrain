import type { Recipe } from '../types.ts';

/**
 * Official OpenAI Codex route through the ChatGPT Codex Responses API.
 *
 * This is deliberately a first-class recipe rather than an alias to `openai`:
 * Codex uses ChatGPT OAuth credentials and the Codex Responses endpoint, not an
 * OpenAI API key or a third-party OpenAI-compatible relay.
 */
const OAUTH_FILE_ENV = 'HERMES_OAUTH_FILE';

const CODEX_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.4-mini',
];

export const openaiCodex: Recipe = {
  id: 'openai-codex',
  name: 'OpenAI Codex (Official OAuth)',
  tier: 'native',
  implementation: 'native-openai',
  base_url_default: 'https://chatgpt.com/backend-api/codex',
  auth_env: {
    required: [],
    optional: [OAUTH_FILE_ENV],
    setup_url: 'https://hermes-agent.nousresearch.com/docs/integrations/providers',
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
    'Authenticate with `hermes auth add openai-codex`; GBrain reads the official OAuth token from HERMES_OAUTH_FILE (default: ~/.hermes/auth.json).',
};
