const id = 'groq';
const defaultApiUrl = 'https://api.groq.com/openai/v1';

// Ordered by preference; first one found in the live catalog is used when the configured model is unavailable.
const fallbackModels = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'gemma2-9b-it',
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
});

const parseModelsResponse = (json) => {
  const list = Array.isArray(json?.data) ? json.data : [];
  return list.map((m) => ({
    id: m.id,
    context_length: m.context_window || null,
    pricing: null,
  }));
};

const buildChatBody = ({ model, prompt }) => ({
  model,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: 256,
  temperature: 0.7,
});

const parseChatResponse = (data) => {
  if (!data?.choices?.[0]?.message) {
    throw new Error('Invalid Groq response format');
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
  timeout: 20000,
  buildChatUrl,
  buildModelsUrl,
  buildHeaders,
  buildChatBody,
  parseModelsResponse,
  parseChatResponse,
};
