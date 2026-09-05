const providers = require('./providers');

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key -> { fetchedAt, models }

// Models that failed with a model-specific error during this process's lifetime
// (decommissioned, needs terms acceptance, insufficient credits, invalid id, etc).
// Skipped on future resolutions so the resolver converges instead of retrying the same dud.
const BAD_MODEL_TTL_MS = 30 * 60 * 1000; // 30 minutes
const badModels = new Map(); // `${providerId}:${modelId}` -> { markedAt, reason }

const badModelKey = (providerId, modelId) => `${providerId}:${modelId}`;

const markModelUnavailable = (providerId, modelId, reason) => {
  badModels.set(badModelKey(providerId, modelId), { markedAt: Date.now(), reason });
  console.warn(`[MODELS] Marking ${providerId}:${modelId} unavailable: ${reason}`);
};

const isModelMarkedBad = (providerId, modelId) => {
  const entry = badModels.get(badModelKey(providerId, modelId));
  if (!entry) return false;
  if (Date.now() - entry.markedAt > BAD_MODEL_TTL_MS) {
    badModels.delete(badModelKey(providerId, modelId));
    return false;
  }
  return true;
};

const cacheKey = (providerId, api_key) => `${providerId}:${api_key ? api_key.slice(0, 8) : ''}`;

/**
 * Fetch the live model catalog for a provider, using a short-lived cache to
 * avoid hammering the provider's API on every agent invocation.
 */
const fetchProviderModels = async (providerId, { api_key } = {}) => {
  const provider = providers.getProvider(providerId);
  if (!provider || !providers.supportsModelListing(providerId)) {
    return { ok: false, models: [], error: 'Provider does not support model listing' };
  }
  const normalizedKey = String(api_key || '').trim();
  if (!normalizedKey) {
    return { ok: false, models: [], error: 'API key required to list models' };
  }

  const key = cacheKey(providerId, normalizedKey);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ok: true, models: cached.models, cached: true };
  }

  try {
    const models = [];
    let pageToken = null;
    do {
      const url = provider.buildModelsUrl(provider.defaultApiUrl, normalizedKey, pageToken);
      const response = await fetch(url, { method: 'GET', headers: provider.buildHeaders(normalizedKey) });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${text}`);
      }
      const json = await response.json();
      models.push(...provider.parseModelsResponse(json));
      pageToken = json.nextPageToken || null;
    }
    while (pageToken);
    cache.set(key, { fetchedAt: Date.now(), models });
    console.log(`[MODELS] Fetched ${models.length} live model(s) for ${providerId}`);
    return { ok: true, models, cached: false };
  } catch (err) {
    console.warn(`[MODELS] Failed to fetch models for ${providerId}:`, err.message);
    return { ok: false, models: [], error: err.message };
  }
};

const clearCache = () => cache.clear();

// Heuristic denylist for model ids that are live but aren't general chat-completion models
// (audio/vision/embedding/moderation/tts models etc.) - used only as a last-resort filter.
const NON_CHAT_PATTERN = /whisper|orpheus|tts|stt|speech|voice|transcribe|translate|embed|rerank|moderation|guard|vision|image|audio/i;

const isFreeModel = (model) => {
  const prompt = model.pricing?.prompt;
  const completion = model.pricing?.completion;
  if (prompt === undefined && completion === undefined) return false;
  return Number(prompt || 0) === 0 && Number(completion || 0) === 0;
};

const pickLiveChatModel = (providerId, models) => {
  const usable = models.filter((m) => !NON_CHAT_PATTERN.test(m.id) && !isModelMarkedBad(providerId, m.id));
  const pool = usable.length > 0 ? usable : models.filter((m) => !isModelMarkedBad(providerId, m.id));
  if (pool.length === 0) return null;

  const free = pool.filter(isFreeModel);
  return (free.length > 0 ? free[0] : pool[0]).id;
};

/**
 * Resolve which model to actually use for a call:
 * - if the requested model is in the live catalog, use it
 * - otherwise fall back to the provider's ordered fallback list, picking the
 *   first one that's confirmed available
 * - if the catalog can't be fetched at all (offline/no key), trust the
 *   requested model rather than blocking the call
 */
const resolveModel = async (providerId, requestedModel, creds = {}) => {
  const provider = providers.getProvider(providerId);
  if (!provider) {
    return { model: requestedModel, source: 'requested', warning: `Unknown provider "${providerId}"` };
  }

  const { ok, models } = await fetchProviderModels(providerId, creds);

  if (!ok || models.length === 0) {
    const model = requestedModel || provider.fallbackModels[0];
    return { model, source: requestedModel ? 'requested-unverified' : 'fallback-unverified' };
  }

  const availableIds = new Set(models.map((m) => m.id));

  if (requestedModel && availableIds.has(requestedModel) && !isModelMarkedBad(providerId, requestedModel)) {
    return { model: requestedModel, source: 'requested' };
  }

  const fallback = (provider.fallbackModels || []).find((m) => availableIds.has(m) && !isModelMarkedBad(providerId, m));
  if (fallback) {
    return {
      model: fallback,
      source: 'fallback',
      warning: requestedModel
        ? `Requested model "${requestedModel}" unavailable on ${providerId}, using fallback "${fallback}"`
        : `No model configured for ${providerId}, using fallback "${fallback}"`,
    };
  }

  // Requested model and all known fallbacks are stale - self-heal by picking a
  // confirmed-live, non-bad, preferably free-tier model from the provider's current catalog.
  const liveModel = pickLiveChatModel(providerId, models);
  if (liveModel) {
    return {
      model: liveModel,
      source: 'live-catalog',
      warning: `Requested model "${requestedModel || '(none)'}" and known fallbacks are unavailable on ${providerId}, using live catalog model "${liveModel}"`,
    };
  }

  return {
    model: requestedModel || provider.fallbackModels[0],
    source: 'unverified',
    warning: `No configured, fallback, or live model found for ${providerId}`,
  };
};

module.exports = { fetchProviderModels, resolveModel, clearCache, markModelUnavailable, isModelMarkedBad, CACHE_TTL_MS };
