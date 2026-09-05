const crypto = require('crypto');
const ledger = require('../core/ledger');
const { queryKnowledgeSummaries } = require('../core/knowledge');

const buildChatContext = async (message = '') => {
  const originalUserMessage = String(message || '').trim();
  const keywords = originalUserMessage.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  const records = queryKnowledgeSummaries({ message: keywords.join(' '), audience: ['internal', 'public'], limit: 5 });
  const contextHashes = records.map((record) => record.hash);
  const context = records.length
    ? `[Recent network knowledge]\n${records.map((record) => `[${record.field}] ${record.summary}`).join('\n')}\n\n---\n\n`
    : '';
  return { enrichedMessage: `${context}${originalUserMessage}`, contextHashes };
};

const encryptResponse = (value) => {
  const key = process.env.MASTER_KEY || process.env.CONSTITUTION_KEY;
  if (!key) return { mode: 'local-runtime', value: String(value || '') };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), value: encrypted.toString('base64') };
};

const persistChatTurn = async ({ userMessage, agentResponse, contextHashes = [], briefVersion = null }) => {
  const payload = { source: 'chat_explorer', user_message_hash: crypto.createHash('sha256').update(String(userMessage || '')).digest('hex'), agent_response: encryptResponse(agentResponse), context_hashes: contextHashes, brief_version: briefVersion, audience: 'node-private' };
  await ledger.appendRecord({ record_type: 'cycle', content_plain: JSON.stringify(payload), audience: 'node-private', graph_type: 'episodic', status: 'promoted' });
  return payload;
};

module.exports = { buildChatContext, persistChatTurn };