const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../../data');
const knowledgePath = path.join(dataDir, 'knowledge.jsonl');
const ensure = () => { if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true }); };
const hashValue = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const readKnowledgeRecords = () => { ensure(); if (!fs.existsSync(knowledgePath)) return []; return fs.readFileSync(knowledgePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch (err) { return null; } }).filter(Boolean); };

const FIELD_PATTERNS = {
	constitution: /\b(rule|principle|founding|immutable|constitutional|mandate)\b/i,
	governance: /\b(vote|decision|board|approve|reject|policy|authority)\b/i,
	enterprise: /\b(revenue|cost|contract|client|invoice|commercial|profit)\b/i,
	learning: /\b(insight|pattern|learned|knowledge|discovery|finding)\b/i,
	self_reflection: /\b(reflect|assess|character|identity|mirror|cycle|deliberat)\b/i,
	application: /\b(feature|interface|user|product|publish|content|brand)\b/i,
	mesh: /\b(external|api|integration|third-party|webhook|federation)\b/i,
	avatar: /\b(presence|identity|public|persona|reputation|represent)\b/i,
	spells: /\b(capability|emerge|unique|network magic|cannot replicate)\b/i,
};

const classifyField = ({ title = '', summary = '', content = '', role = '' } = {}) => {
	const roleField = { CEO: 'operational', CFO: 'enterprise', CTO: 'operational', CMO: 'application', PRO: 'governance', CSO: 'self_reflection' }[String(role).toUpperCase()];
	if (roleField) return roleField;
	const text = `${title} ${summary} ${content}`;
	return Object.entries(FIELD_PATTERNS).find(([, pattern]) => pattern.test(text))?.[0] || 'operational';
};

const createSummary = (value = '') => String(value)
	.replace(/\s+/g, ' ')
	.trim()
	.slice(0, 800);

const appendKnowledge = ({ title, summary, content, status = 'promoted', audience = 'internal', source_cycle_id = null, field, role = '', graph_type = 'knowledge' }) => {
	ensure();
	const fullContent = String(content || '');
	const shortSummary = createSummary(summary || fullContent);
	const record = {
		id: crypto.randomUUID(),
		created_at: new Date().toISOString(),
		title: String(title || 'Network knowledge'),
		summary: shortSummary,
		content: fullContent,
		status,
		audience,
		field: field || classifyField({ title, summary: shortSummary, content: fullContent, role }),
		graph_type,
		source_cycle_id,
		hash: hashValue(fullContent || shortSummary || title),
	};
	fs.appendFileSync(knowledgePath, `${JSON.stringify(record)}\n`);
	return record;
};

const listPromotedKnowledge = () => readKnowledgeRecords().filter((record) => record.status === 'promoted' && !record.retracted).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
const queryKnowledgeSummaries = ({ message = '', field = null, audience = null, limit = 5 } = {}) => {
	const words = String(message).toLowerCase().split(/\W+/).filter(Boolean);
	return listPromotedKnowledge()
		.filter((record) => !field || record.field === field)
		.filter((record) => !audience || audience.includes(record.audience || 'internal'))
		.filter((record) => !words.length || words.some((word) => `${record.title} ${record.summary}`.toLowerCase().includes(word)))
		.slice(0, limit);
};
const buildKnowledgeContext = (message = '', options = {}) => {
	const records = queryKnowledgeSummaries({ message, ...options });
	return records.length ? `[Recent network knowledge summaries]\n${records.map((record) => `- ${record.title} [${record.field || 'operational'}] (${record.hash}): ${record.summary}`).join('\n')}\n\n---\n\n${message}` : String(message);
};
const fetchKnowledgeByHash = (hash) => readKnowledgeRecords().find((record) => record.hash === String(hash) && !record.retracted) || null;

module.exports = { appendKnowledge, listPromotedKnowledge, queryKnowledgeSummaries, buildKnowledgeContext, fetchKnowledgeByHash, classifyField, createSummary, readKnowledgeRecords, knowledgePath };
