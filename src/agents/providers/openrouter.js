const id = 'openrouter';
const defaultApiUrl = 'https://openrouter.ai/api/v1';

// Ordered by preference; first one found in the live catalog is used when the configured model is unavailable.
const fallbackModels = [
  'mistralai/mistral-7b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'google/gemma-2-9b-it:free',
];

const normalizeBase = (base) => (base || defaultApiUrl).replace(/\/$/, '');

const buildChatUrl = (base) => {
  const b = normalizeBase(base);
  return b.endsWith('/chat/completions') ? b : `${b}/chat/completions`;
};

const buildModelsUrl = (base) => {
  const b = normalizeBase(base).replace(/\/chat\/completions$/, '');
  return b.endsWith('/models') ? b : `${b}/models`;
};

const buildHeaders = (api_key) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${api_key}`,
  'HTTP-Referer': 'https://dencken.net', // Required by OpenRouter
  'X-Title': 'Dencken Network', // Required by OpenRouter
});

const parseModelsResponse = (json) => {
  const list = Array.isArray(json?.data) ? json.data : [];
  return list.map((m) => ({
    id: m.id,
    context_length: m.context_length || null,
    pricing: m.pricing || null,
  }));
};

const buildChatBody = ({ model, prompt }) => ({
  model,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 1024,
  temperature: 0.7,
});

const parseChatResponse = (data) => {
  if (!data?.choices?.[0]?.message) {
    throw new Error('Invalid OpenRouter response format');
  }
  return {
    content: data.choices[0].message.content,
    stop_reason: data.choices[0].finish_reason,
    tokens_used: data.usage?.total_tokens || 0,
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
