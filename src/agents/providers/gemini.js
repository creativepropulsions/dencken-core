const id = 'gemini';
const defaultApiUrl = 'https://generativelanguage.googleapis.com/v1beta';

const fallbackModels = ['gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

const normalizeBase = (base) => (base || defaultApiUrl).replace(/\/$/, '');

const withApiKey = (url, api_key) => `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(api_key)}`;
const buildChatUrl = (base, model, api_key) => withApiKey(`${normalizeBase(base)}/models/${encodeURIComponent(model)}:generateContent`, api_key);
const buildModelsUrl = (base, api_key, pageToken = null) => {
  const url = withApiKey(`${normalizeBase(base)}/models?pageSize=1000`, api_key);
  return pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
};
const buildHeaders = (api_key) => ({ 'Content-Type': 'application/json', 'x-goog-api-key': api_key });

const parseModelsResponse = (json) => {
  const list = Array.isArray(json?.models) ? json.models : [];
  return list
    .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
    .map((model) => ({
      id: String(model.name || '').replace(/^models\//, ''),
      context_length: model.inputTokenLimit || null,
      output_token_limit: model.outputTokenLimit || null,
      pricing: null,
    }));
};

const buildChatBody = ({ prompt }) => ({
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
});

const parseChatResponse = (data) => {
  const candidate = data?.candidates?.[0];
  const content = candidate?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!content) throw new Error('Invalid Gemini response format');
  return {
    content,
    stop_reason: candidate.finishReason || null,
    tokens_used: data?.usageMetadata?.totalTokenCount || 0,
  };
};

module.exports = {
  id,
  defaultApiUrl,
  fallbackModels,
  timeout: 30000,
  buildChatUrl,
  buildModelsUrl,
  buildHeaders,
  buildChatBody,
  parseModelsResponse,
  parseChatResponse,
};
