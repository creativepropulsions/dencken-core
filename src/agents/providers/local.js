const id = 'local';
const defaultApiUrl = null;
const fallbackModels = ['local-simulation'];

// Local provider has no live endpoints - present for registry symmetry only.
module.exports = {
  id,
  defaultApiUrl,
  fallbackModels,
  timeout: 100,
  buildChatUrl: () => null,
  buildModelsUrl: () => null,
  buildHeaders: () => ({}),
};
