const openrouter = require('./openrouter');
const groq = require('./groq');
const gemini = require('./gemini');
const local = require('./local');

// Add new providers here - each adapter must implement the shape defined in openrouter.js/groq.js.
const registry = {
  [openrouter.id]: openrouter,
  [groq.id]: groq,
  [gemini.id]: gemini,
  [local.id]: local,
};

const getProvider = (providerId) => registry[providerId] || null;
const listProviderIds = () => Object.keys(registry);
const supportsModelListing = (providerId) => {
  const provider = getProvider(providerId);
  return Boolean(provider && typeof provider.buildModelsUrl === 'function' && provider.buildModelsUrl());
};

module.exports = { registry, getProvider, listProviderIds, supportsModelListing };
