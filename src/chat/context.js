const crypto = require('crypto');
const ledger = require('../core/ledger');
const { listPromotedKnowledge } = require('../core/knowledge');

const buildChatContext = (message = '') => {
  const text = String(message || '').trim();
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const records = listPromotedKnowledge().filter((record) => !words.length || words.some((word) => `${record.title} ${record.summary} ${record.content}`.toLowerCase().includes(word))).slice(0, 5);
  if (!records.length) return text;
  return `[Recent network knowledge]\n${records.map((record) => `- ${record.title}: ${(record.summary || record.content).slice(0, 180)}`).join('\n')}\n\n---\n\n${text}`;
};

const encryptResponse = (value) => {
  const key = process.env.MASTER_KEY || process.env.CONSTITUTION_KEY;
  if (!key) return { mode: 'local-runtime', value: String(value || '') };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: encrypted.toString('base64') };
};

const persistChatTurn = async ({ userMessage, agentResponse, contextHashes = [] }) => {
  const payload = { source: 'chat_explorer', user_message: crypto.createHash('sha256').update(String(userMessage || '')).digest('hex'), agent_response: encryptResponse(agentResponse), context_hashes: contextHashes, audience: 'node-private' };
  await ledger.appendRecord({ record_type: 'cycle', content_plain: JSON.stringify(payload) });
  return payload;
};

module.exports = { buildChatContext, persistChatTurn };