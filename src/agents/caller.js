/**
 * Provider-agnostic AI agent API caller
 * Supports OpenRouter, Groq, and local simulation via a pluggable provider
 * registry (see ./providers). Adding a new provider only requires a new
 * adapter file registered in ./providers/index.js - no changes needed here.
 *
 * Usage:
 *   const response = await invokeAgent({
 *     agent_id: 'agent-cso',
 *     prompt: 'Evaluate the proposal...',
 *     context: { cycle_id, initiator_message, ... }
 *   });
 */

const keychain = require('../core/keychain');
const { loadAgentPool } = require('./pool');
const providers = require('./providers');
const modelRegistry = require('./modelRegistry');
const usageMetrics = require('./usageMetrics');
const { updateHealth } = require('./health');

const PROVIDERS = {
  OPENROUTER: 'openrouter',
  GROQ: 'groq',
  LOCAL: 'local',
};

/**
 * Generic chat-completion caller shared by every provider that implements
 * the buildChatUrl/buildHeaders/buildChatBody/parseChatResponse contract.
 */
const invokeChatCompletion = async (providerId, opts = {}) => {
  const { model, prompt, api_key, api_url } = opts;
  const provider = providers.getProvider(providerId);

  if (!provider) {
    throw new Error(`Unknown provider "${providerId}"`);
  }
  if (!api_key) {
    throw new Error(`${providerId} API key required`);
  }

  const url = provider.buildChatUrl(provider.defaultApiUrl, model, api_key);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: provider.buildHeaders(api_key),
      body: JSON.stringify(provider.buildChatBody({ model, prompt })),
      timeout: provider.timeout,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${providerId} API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    const parsed = provider.parseChatResponse(data);

    return { ok: true, provider: providerId, model, ...parsed };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${providerId} request timeout`);
    }
    throw error;
  }
};

// Backwards-compatible named wrappers (kept for anything importing them directly).
const invokeOpenRouter = (opts = {}) => invokeChatCompletion(PROVIDERS.OPENROUTER, opts);
const invokeGroq = (opts = {}) => invokeChatCompletion(PROVIDERS.GROQ, opts);

/**
 * Local simulation fallback (for development/testing)
 */
const invokeLocal = async (opts = {}) => {
  const { model, prompt, agent_id, failure_reason = null } = opts;

  // Simple simulation: echo the prompt with a role-based prefix
  const roleHints = {
    'initiator': 'Initiating deliberation:',
    'respondent': 'Responding strategically:',
    'synthesis': 'Synthesizing findings:',
  };

  const prefix = roleHints[agent_id?.split('-')[1]] || 'Processing:';

  return {
    ok: true,
    provider: PROVIDERS.LOCAL,
    model,
    content: `${prefix} ${prompt.slice(0, 100)}... [local simulation]`,
    stop_reason: 'simulation',
    tokens_used: 0,
    failure_reason,
  };
};

/**
 * Main agent invocation function
 * Resolves the actual model to use against the provider's live catalog
 * (falling back to a known-good model when needed), routes to the provider
 * adapter, and records usage metrics for every call.
 *
 * @param {Object} opts
 * @param {string} opts.agent_id - Agent identifier (e.g., 'agent-cso')
 * @param {string} opts.prompt - The prompt/message for the agent
 * @param {string} opts.provider - Provider override (openrouter, groq, local)
 * @param {Object} opts.context - Optional context (cycle_id, conversation history, etc.)
 * @returns {Promise<Object>} - { ok, provider, model, content, stop_reason, tokens_used }
 */
const invokeAgent = async (opts = {}) => {
  const { agent_id, prompt, provider, context, allowFallback = true, activeProviders = [] } = opts;

  if (!agent_id || !prompt) {
    throw new Error('agent_id and prompt required');
  }

  // Load agent definition from pool to get model
  const agentPool = loadAgentPool();
  let agentDef = agentPool.find((a) => a.id === agent_id);
  const secret = keychain.getAgentSecret(agent_id);

  if (!agentDef && secret) {
    agentDef = { id: agent_id, role: 'respondent', provider: secret.provider, model: secret.model };
  }
  if (!agentDef) {
    console.warn(`[CALLER] Agent ${agent_id} not found in pool, falling back to local simulation`);
    return invokeLocal({ agent_id, model: 'local-simulation', prompt });
  }

  if (!secret) {
    console.warn(`[CALLER] Agent ${agent_id} not found in keychain, falling back to local simulation`);
    return invokeLocal({ agent_id, model: agentDef.model, prompt });
  }

  if (!allowFallback) {
    const result = await invokeWithSelfHeal({
      agent_id: secret.agent_id,
      targetProvider: secret.provider || provider || agentDef.provider,
      requestedModel: secret.model || agentDef.model,
      api_key: secret.api_key,
      api_url: secret.api_url,
      prompt,
    });
    return { ...result, requested_agent_id: agent_id, profile_agent_id: secret.agent_id };
  }

  const allProfiles = keychain.listAgentSecrets().filter((profile) => profile.api_key && profile.provider !== PROVIDERS.LOCAL);
  const fallbackProfiles = allProfiles
    .filter((profile) => profile.agent_id !== secret.agent_id)
    .sort((left, right) => {
      const leftUnused = Number(!activeProviders.includes(left.provider));
      const rightUnused = Number(!activeProviders.includes(right.provider));
      if (leftUnused !== rightUnused) return rightUnused - leftUnused;
      return Number(right.preferred) - Number(left.preferred);
    });
  const profiles = [secret, ...fallbackProfiles];

  for (const profile of profiles) {
    const targetProvider = profile.provider || (profile.agent_id === secret.agent_id ? provider || agentDef.provider : null);
    const requestedModel = profile.model || (profile.agent_id === secret.agent_id ? agentDef.model : null);
    const result = await invokeWithSelfHeal({
      agent_id: profile.agent_id,
      targetProvider,
      requestedModel,
      api_key: profile.api_key,
      api_url: profile.api_url,
      prompt,
    });

    if (result.provider !== PROVIDERS.LOCAL) {
      return { ...result, requested_agent_id: agent_id, profile_agent_id: profile.agent_id };
    }
    console.warn(`[CALLER] Profile ${profile.agent_id} could not serve role ${agentDef.role}; trying next profile`);
  }

  console.warn(`[CALLER] No configured provider profile could serve role ${agentDef.role}, using local simulation`);
  return invokeLocal({ agent_id, model: secret.model || agentDef.model, prompt });
};

// Errors that indicate the *model itself* is unusable (as opposed to a network/auth issue) -
// these are worth marking bad and retrying once with a different model.
const MODEL_SPECIFIC_ERROR_PATTERN = /model_decommissioned|model_terms_required|not a valid model|no endpoints found|requires more credits|model_not_found|does not exist|unknown model/i;

const invokeWithSelfHeal = async ({ agent_id, targetProvider, requestedModel, api_key, api_url, prompt }, attempt = 1) => {
  const resolution = await modelRegistry.resolveModel(targetProvider, requestedModel, { api_key });
  if (resolution.warning) {
    console.warn(`[CALLER] ${agent_id}: ${resolution.warning}`);
  }
  const model = resolution.model;

  console.log(`[CALLER] Invoking ${agent_id} via ${targetProvider} (model: ${model}, source: ${resolution.source})`);

  const startedAt = Date.now();
  try {
    const result = await invokeChatCompletion(targetProvider, { model, prompt, api_key });
    usageMetrics.recordUsage({
      agent_id,
      provider: targetProvider,
      model,
      tokens_used: result.tokens_used || 0,
      ok: true,
      latency_ms: Date.now() - startedAt,
    });
    updateHealth(agent_id, { ok: true, latency_ms: Date.now() - startedAt });
    return result;
  } catch (error) {
    console.error(`[CALLER] Error invoking agent ${agent_id} via ${targetProvider}:`, error.message);
    usageMetrics.recordUsage({
      agent_id,
      provider: targetProvider,
      model,
      tokens_used: 0,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: error.message,
    });
    updateHealth(agent_id, { ok: false, latency_ms: Date.now() - startedAt, error: error.message });

    if (attempt === 1 && MODEL_SPECIFIC_ERROR_PATTERN.test(error.message)) {
      modelRegistry.markModelUnavailable(targetProvider, model, error.message);
      console.warn(`[CALLER] Retrying ${agent_id} on ${targetProvider} with a different model`);
      return invokeWithSelfHeal({ agent_id, targetProvider, requestedModel, api_key, api_url, prompt }, 2);
    }

    // Graceful fallback to local simulation on error
    return invokeLocal({ agent_id, model: model || 'local-simulation', prompt, failure_reason: error.message });
  }
};

/**
 * Batch invoke multiple agents (for parallel cycle execution)
 * Useful for running multiple respondent agents simultaneously
 */
const invokeBatch = async (agents = [], prompt) => {
  const promises = agents.map((agent) =>
    invokeAgent({ agent_id: agent.id, prompt })
      .then((result) => ({ agent: agent.id, ...result }))
      .catch((error) => ({ agent: agent.id, ok: false, error: error.message }))
  );

  return Promise.all(promises);
};

module.exports = {
  invokeAgent,
  invokeBatch,
  invokeChatCompletion,
  invokeOpenRouter,
  invokeGroq,
  invokeLocal,
  PROVIDERS,
};
